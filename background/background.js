/**
 * ShahzaibSEO Background Service Worker - Enhanced v2.1
 * Improved messaging, caching, and error handling
 */

// Import shared libs (MV3 service worker — path relative to this script)
try {
  importScripts('../libs/niche-engine.js');
} catch (e1) {
  try {
    // Fallback if relative path resolution differs by Chrome version
    importScripts('/libs/niche-engine.js');
  } catch (e2) {
    console.warn('[ShahzaibSEO] niche-engine import failed', e1, e2);
  }
}

// Configuration

// URLs Chrome / Google block for extension fetches (CORS / policy).
// Skip silently — never surface as extension Errors page noise.
function isRestrictedFetchUrl(url) {
  try {
    const u = new URL(url);
    const h = (u.hostname || '').toLowerCase();
    const blocked = [
      'chromewebstore.google.com',
      'chrome.google.com',
      'clients2.google.com',
      'clients1.google.com',
      'accounts.google.com',
      'myaccount.google.com',
      'ogs.google.com',
      'play.google.com',
      'payments.google.com',
      'workspace.google.com'
    ];
    if (blocked.some(b => h === b || h.endsWith('.' + b))) return true;
    if (h === 'chrome' || u.protocol === 'chrome:' || u.protocol === 'chrome-extension:') return true;
    return false;
  } catch (_) {
    return true;
  }
}

const CONFIG = {
  CACHE_TTL: 5 * 60 * 1000, // 5 minutes — light / volatile data
  // Credit-heavy APIs (KE traffic, DA/DR, domain metrics): cache 24h to save tokens/credits
  LONG_CACHE_TTL: 24 * 60 * 60 * 1000, // 24 hours
  KW_CACHE_TTL: 7 * 24 * 60 * 60 * 1000, // 7 days — keyword volume (1 credit/kw)
  PERSISTENT_CACHE_TTL: 24 * 60 * 60 * 1000, // 24 hours — Technical tab slow endpoints
  CREDIT_CACHE_TTL: 24 * 60 * 60 * 1000, // 24 hours — alias for any paid KE call
  API_TIMEOUT: 15000,
  MAX_RETRIES: 3
};

// Direct per-TLD RDAP endpoints — tried BEFORE the generic rdap.org bootstrap
// redirector. rdap.org has to look up the right registry and redirect on every
// call, which is slower and occasionally flaky; hitting the registry directly
// for common TLDs is faster and more reliable. (Borrowed from SERP X-Ray.)

// WHOIS metadata fallback for country-code TLDs. RDAP is preferred when the
// registry publishes it; otherwise ShahzaibSEO can show the registry WHOIS server
// and use the HTTPS public WHOIS relay below for registration dates/status.
// The official registry metadata is refreshed from IANA so newly delegated or
// changed TLD records do not require a code update.
const COMMON_WHOIS_SERVERS = {
  sa: 'whois.nic.net.sa', ae: 'whois.aeda.net.ae', qa: 'whois.registry.qa',
  uk: 'whois.nominet.uk', au: 'whois.auda.org.au', ca: 'whois.cira.ca',
  in: 'whois.registry.in', jp: 'whois.jprs.jp', kr: 'whois.kr',
  cn: 'whois.cnnic.cn', br: 'whois.registro.br', fr: 'whois.nic.fr',
  de: 'whois.denic.de', es: 'whois.nic.es', it: 'whois.nic.it',
  nl: 'whois.domain-registry.nl', be: 'whois.dns.be', ch: 'whois.nic.ch',
  at: 'whois.nic.at', se: 'whois.iis.se', no: 'whois.norid.no',
  dk: 'whois.dk-hostmaster.dk', fi: 'whois.fi', pl: 'whois.dns.pl',
  cz: 'whois.nic.cz', sk: 'whois.sk-nic.sk', hu: 'whois.nic.hu',
  ro: 'whois.rotld.ro', pt: 'whois.dns.pt', ie: 'whois.domainregistry.ie',
  is: 'whois.isnic.is', il: 'whois.isoc.org.il', za: 'whois.registry.net.za',
  mx: 'whois.mx', ar: 'whois.nic.ar', cl: 'whois.nic.cl', co: 'whois.nic.co',
  sg: 'whois.sgnic.sg', my: 'whois.mynic.my', hk: 'whois.hkirc.hk',
  tw: 'whois.twnic.net.tw', id: 'whois.id', th: 'whois.thnic.co.th',
  vn: 'whois.vnnic.vn', ru: 'whois.tcinet.ru', ua: 'whois.ua',
  nz: 'whois.dnc.org.nz', tr: 'whois.trabis.gov.tr', gr: 'grwhois.internet.gr',
  bg: 'whois.register.bg', hr: 'whois.dns.hr', si: 'whois.register.si',
  rs: 'whois.rnids.rs', ee: 'whois.tld.ee', lv: 'whois.nic.lv',
  lt: 'whois.domreg.lt', lu: 'whois.dns.lu', mt: 'whois.nic.org.mt',
  cy: 'whois.nic.cy', pt: 'whois.dns.pt', pk: 'whois.pknic.net.pk',
  ph: 'whois.dot.ph'
};

function tldCountryName(tld) {
  const key = String(tld || '').toLowerCase();
  const special = { uk: 'United Kingdom', eu: 'European Union', aq: 'Antarctica' };
  if (special[key]) return special[key];
  if (!/^[a-z]{2}$/.test(key)) return null;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(key.toUpperCase()) || null;
  } catch (_) { return null; }
}

function stripIanaHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

async function fetchIanaTldMeta(tld) {
  const key = String(tld || '').toLowerCase();
  if (!key) return null;
  const ck = 'iana_tld_meta_' + key;
  try {
    const cached = await getCachedData(ck);
    if (cached?.ok) return cached;
  } catch (_) {}
  try {
    const resp = await fetch('https://www.iana.org/domains/root/db/' + encodeURIComponent(key) + '.html', {
      headers: { Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const registryMatch = html.match(/<h2[^>]*>Registry Information<\/h2>([\s\S]*?)(?:<h2|$)/i);
    const registryHtml = registryMatch ? registryMatch[1] : '';
    const registryText = stripIanaHtml(registryHtml);
    const managerMatch = html.match(/<h2[^>]*>ccTLD Manager<\/h2>([\s\S]*?)(?:<h2|$)/i);
    const managerBlock = managerMatch ? managerMatch[1] : '';
    const managerText = stripIanaHtml(managerBlock.replace(/<br\s*\/?>(?:\s*)/gi, '\n').replace(/<\/(?:p|div|li|address)>/gi, '\n'))
      .split(/\n+/).map(v => v.trim()).filter(Boolean)[0] || '';
    const regHref = registryHtml.match(/URL for registration services:\s*(?:<[^>]+>)*<a[^>]+href=["']([^"']+)["']/i);
    const registrationUrl = regHref ? regHref[1] : ((registryText.match(/URL for registration services:\s*(https?:\/\/\S+)/i) || [])[1] || null);
    const whois = (registryText.match(/WHOIS Server:\s*([^\s]+)/i) || [])[1] || COMMON_WHOIS_SERVERS[key] || null;
    const rdap = (registryText.match(/RDAP Server:\s*(https?:\/\/\S+)/i) || [])[1] || null;
    const updated = (registryText.match(/Record last updated\s+([^.]*)\./i) || [])[1] || null;
    const registered = (registryText.match(/Registration date\s+([^.]*)\./i) || [])[1] || null;
    const result = {
      ok: true,
      tld: '.' + key,
      country: tldCountryName(key),
      type: /Country-code top-level domain/i.test(stripIanaHtml(html.slice(0, 7000))) ? 'ccTLD' : 'TLD',
      manager: managerText ? managerText.split(/\s{2,}|\n/)[0].trim() : null,
      registrationUrl,
      whoisServer: whois || null,
      rdapServer: rdap || null,
      ianaUpdated: updated ? updated.trim() : null,
      ianaRegistrationDate: registered ? registered.trim() : null,
      ianaUrl: 'https://www.iana.org/domains/root/db/' + encodeURIComponent(key) + '.html'
    };
    await setCachedData(ck, result, 30 * 24 * 60 * 60 * 1000);
    return result;
  } catch (_) { return null; }
}

async function publicWhoisRelayLookup(domain) {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '').trim();
  if (!d) return null;
  const sources = [
    { name: 'WHOIS public relay', url: 'https://who-dat.as93.net/' + encodeURIComponent(d) },
    { name: 'WHOIS public relay 2', url: 'https://api.whois.vu/?q=' + encodeURIComponent(d) }
  ];
  for (const src of sources) {
    try {
      const resp = await fetch(src.url, { signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json' } });
      if (!resp.ok) continue;
      const data = await resp.json();
      const dates = data?.dates || {};
      const created = normalizeWhoisDate(dates.created ?? data.created ?? data.creationDate);
      const expires = normalizeWhoisDate(dates.expires ?? data.expires ?? data.expirationDate);
      const updated = normalizeWhoisDate(dates.updated ?? data.updated ?? data.updatedDate);
      const nameservers = (data.nameservers || [])
        .map(n => typeof n === 'string' ? n : (n?.name || n?.host || n?.ldhName || ''))
        .filter(Boolean);
      const registrar = typeof data.registrar === 'string' ? data.registrar : (data.registrar?.name || data.registrarName || null);
      const status = Array.isArray(data.status) ? data.status : (Array.isArray(data.domainStatus) ? data.domainStatus : []);
      if (created || expires || registrar || nameservers.length) {
        return {
          ok: true,
          createdDate: created,
          expirationDate: expires,
          updatedDate: updated,
          registrar,
          nameservers: nameservers.slice(0, 8),
          status: status.map(String).slice(0, 8),
          cdnHint: detectCdnFromNameservers(nameservers),
          source: src.name
        };
      }
    } catch (_) {}
  }
  return null;
}

const COMMON_RDAP_ENDPOINTS = {
  // Verisign
  com: "https://rdap.verisign.com/com/v1/domain/",
  net: "https://rdap.verisign.com/net/v1/domain/",
  // PIR
  org: "https://rdap.publicinterestregistry.org/rdap/domain/",
  // Nominet
  uk: "https://rdap.nominet.uk/uk/domain/",
  // Identity Digital / Donuts family (.io .co .info .ai .xyz .online .site .store .tech .app via Google below)
  io: "https://rdap.identitydigital.services/rdap/domain/",
  co: "https://rdap.nic.co/domain/",
  info: "https://rdap.identitydigital.services/rdap/domain/",
  ai: "https://rdap.identitydigital.services/rdap/domain/",
  xyz: "https://rdap.identitydigital.services/rdap/domain/",
  online: "https://rdap.identitydigital.services/rdap/domain/",
  site: "https://rdap.identitydigital.services/rdap/domain/",
  store: "https://rdap.identitydigital.services/rdap/domain/",
  tech: "https://rdap.identitydigital.services/rdap/domain/",
  club: "https://rdap.identitydigital.services/rdap/domain/",
  life: "https://rdap.identitydigital.services/rdap/domain/",
  world: "https://rdap.identitydigital.services/rdap/domain/",
  email: "https://rdap.identitydigital.services/rdap/domain/",
  digital: "https://rdap.identitydigital.services/rdap/domain/",
  agency: "https://rdap.identitydigital.services/rdap/domain/",
  studio: "https://rdap.identitydigital.services/rdap/domain/",
  me: "https://rdap.identitydigital.services/rdap/domain/",
  cc: "https://rdap.identitydigital.services/rdap/domain/",
  pro: "https://rdap.identitydigital.services/rdap/domain/",
  // Google Registry
  app: "https://rdap.nic.google/domain/",
  dev: "https://rdap.nic.google/domain/",
  page: "https://rdap.nic.google/domain/",
  new: "https://rdap.nic.google/domain/",
  // CentralNic
  pw: "https://rdap.centralnic.com/pw/domain/",
  // AFNIC
  fr: "https://rdap.nic.fr/domain/",
  // DENIC
  de: "https://rdap.denic.de/domain/",
  // SIDN
  nl: "https://rdap.sidn.nl/domain/",
  // NIC.AT
  at: "https://rdap.nic.at/domain/",
  // SWITCH
  ch: "https://rdap.nic.ch/domain/",
  // Red.es
  es: "https://rdap.nic.es/domain/",
  // Registro.it
  it: "https://rdap.nic.it/domain/",
  // DNS Belgium
  be: "https://rdap.dns.be/domain/",
  // NIC.br
  br: "https://rdap.registro.br/domain/",
  // AUDA
  au: "https://rdap.auda.org.au/rdap/domain/",
  // JPRS
  jp: "https://rdap.jprs.jp/domain/",
  // KRNIC
  kr: "https://rdap.nic.or.kr/domain/",
  // CNNIC
  cn: "https://rdap.cnnic.cn/rdap/domain/",
  // .in NIXI
  in: "https://rdap.nixiregistry.in/rdap/domain/",
  // .tv / .us etc via Verisign-style
  tv: "https://rdap.nic.tv/domain/",
  us: "https://rdap.nic.us/domain/",
  // .ca CIRA
  ca: "https://rdap.ca.fury.ca/rdap/domain/",
  // .eu
  eu: "https://rdap.eu/domain/",
  // .biz
  biz: "https://rdap.nic.biz/domain/",
  // .name
  name: "https://rdap.nic.name/domain/",
  // .mobi
  mobi: "https://rdap.identitydigital.services/rdap/domain/",
  // .shop
  shop: "https://rdap.gmoregistry.net/rdap/domain/",
  // .blog
  blog: "https://rdap.blog.fury.ca/rdap/domain/",
  // .cloud
  cloud: "https://rdap.registry.google/domain/",
  // .top
  top: "https://rdap.nic.top/domain/",
  // .icu
  icu: "https://rdap.nic.icu/domain/",
  // .vip
  vip: "https://rdap.nic.vip/domain/",
  // .pk — try PKNIC if available; else rdap.org bootstrap
  pk: "https://rdap.org/domain/"
};

// Track active fetches to prevent duplicates
const fetchingUrls = new Set();
const messageHandlers = new Map();

// Global no-op cleanup shim for top-level message handlers.
// Some action handlers call cleanup() after sendResponse, but they live
// outside the IIFE that owns the per-handler messageHandlers entry, so
// the local `cleanup` is undefined here. Provide a harmless fallback so
// those calls don't throw ReferenceError and break the extension.
function cleanup() { /* no-op */ }

// Initialize default settings
chrome.runtime.onInstalled.addListener(() => {
  console.log('[RP] Extension installed/updated');
  initializeDefaultSettings();
  initializeDefaultBlacklist();
});

// Helper function to initialize default settings
function initializeDefaultSettings() {
  chrome.storage.local.get(['defaultSettingsInitialized'], (result) => {
    if (!result.defaultSettingsInitialized) {
      const defaults = {
        defaultSettingsInitialized: true,
        toolbarEnabled: true,
        darkMode: false,
        autoAnalyze: true,
        maxConcurrentAnalyses: 3
      };
      chrome.storage.local.set(defaults, () => {
        console.log('[RP] Default settings initialized');
      });
    }
  });
}

// Helper function to initialize default blacklist
function initializeDefaultBlacklist() {
  chrome.storage.local.get(['domainBlacklist'], (prefs) => {
    if (!prefs.domainBlacklist || prefs.domainBlacklist.length === 0) {
      const defaultBlacklist = [
        'facebook.com', 'chatgpt.com', 'google.com', 'mail.google.com',
        'x.com', 'claude.ai', 'gemini.google.com', 'linkedin.com',
        'instagram.com', 'youtube.com'
      ];
      chrome.storage.local.set({ domainBlacklist: defaultBlacklist }, () => {
        console.log('[RP] Default blacklist domains initialized');
      });
    }
  });
}

// Badge management
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') updateBadge(tabId);
});
chrome.tabs.onActivated.addListener(info => updateBadge(info.tabId));

function updateBadge(tabId) {
  if (tabId == null) return;
  chrome.tabs.get(tabId).then(tab => {
    if (!tab) return;
    const ok = (tab.url || '').startsWith('http');
    return Promise.all([
      chrome.action.setBadgeText({ tabId, text: ok ? '' : '-' }).catch(() => {}),
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#6b7280' }).catch(() => {})
    ]);
  }).catch(() => {});
}

// ─── API Key Management ────────────────────────────────────────────
const _BUILTIN_KEY_PARTS = []; // Configure your own PageSpeed key in Settings.
let _pageSpeedApiKey = null;

async function getPageSpeedApiKey() {
  if (_pageSpeedApiKey) return _pageSpeedApiKey;
  try {
    const result = await chrome.storage.sync.get('pageSpeedApiKey');
    if (result.pageSpeedApiKey) { _pageSpeedApiKey = result.pageSpeedApiKey; return _pageSpeedApiKey; }
  } catch (_) {}
  _pageSpeedApiKey = _BUILTIN_KEY_PARTS.join('');
  return _pageSpeedApiKey;
}

// Ahrefs APIv3 key for free public endpoints (domain-rating-free etc.)
// Stored key (chrome.storage.sync.ahrefsApiKey) takes precedence; falls back to built-in.
const _AHREFS_BUILTIN_KEY = ''; // Configure your own Ahrefs key in Settings.
let _ahrefsApiKey = null;

async function getAhrefsApiKey() {
  if (_ahrefsApiKey) return _ahrefsApiKey;
  try {
    const result = await chrome.storage.sync.get('ahrefsApiKey');
    if (result.ahrefsApiKey) { _ahrefsApiKey = result.ahrefsApiKey; return _ahrefsApiKey; }
  } catch (_) {}
  _ahrefsApiKey = _AHREFS_BUILTIN_KEY;
  return _ahrefsApiKey;
}

// ─── Cache Helpers ─────────────────────────────────────────────────
function cacheKey(prefix, url) { return prefix + '_' + url; }

/**
 * Derives the cache key for an incoming message so the dedup block
 * can serve a cached response instead of "busy" when a request is
 * already in-flight (e.g., popup was closed and quickly reopened).
 */
function deriveCacheKeyFromMsg(msg) {
  const domain = (msg.domain || '').replace(/^www\./, '').replace(/^https?:\/\//, '');
  const url    = (msg.url || '').trim();
  switch (msg.action) {
    case 'IP_GEO':        return 'ipgeo_'        + domain;
    case 'DNS_LOOKUP':    return 'dns_'           + domain;
    case 'HTTP_HEADERS':  return 'http_headers_'  + domain;
    case 'CERT_LOOKUP': {
      const sub = msg.subdomains === true;
      return 'crt_' + (sub ? 'sub_' : '') + domain;
    }
    case 'WAYBACK_CDX': {
      const blogPath = msg.blogPath || '';
      return 'wayback_cdx_' + domain + (blogPath ? '_' + blogPath.replace(/\//g, '_') : '');
    }
    case 'ARCHIVE_AVAILABLE': return 'archive_avail_' + url;
    case 'RDAP_LOOKUP':   return 'rdap_'          + domain;
    default: return null;
  }
}

// Cache backed by chrome.storage.local (persists across page reloads and SW
// restarts) instead of storage.session — so once a domain's DA/DR/traffic/age
// is fetched it keeps showing without re-hitting the (rate-limited) free APIs.
async function getCachedData(key) {
  try {
    const result = await chrome.storage.local.get(key);
    const cached = result[key];
    if (cached && cached.timestamp && Date.now() - cached.timestamp < cached.ttl) {
      return cached.data;
    }
  } catch (_) {}
  return null;
}

async function setCachedData(key, data, ttl = CONFIG.CACHE_TTL) {
  try {
    await chrome.storage.local.set({ [key]: { data, timestamp: Date.now(), ttl } });
  } catch (_) {}
}

// ─── In-flight request coalescing ─────────────────────────────────
// The SERP overlay and the sidebar both ask for DA / DR / traffic / age of the
// same 10 domains at the same moment. Without coalescing that doubles the hits
// to the (rate-limited) free APIs, which then throttle and time out — leaving
// half the values stuck on "..." / "--". coalesce() makes concurrent callers
// for the same key share ONE network round-trip.
const _inflight = new Map();
function coalesce(key, producer) {
  if (_inflight.has(key)) return _inflight.get(key);
  const p = Promise.resolve().then(producer).finally(() => _inflight.delete(key));
  _inflight.set(key, p);
  return p;
}

// Per-API concurrency limiter. The sidebar asks for all 10 domains at once; the
// free APIs throttle bursts, so cap in-flight requests per endpoint (the rest
// queue). Combined with coalesce(), this is what stops values sticking on "--".
function makeLimiter(max) {
  let active = 0;
  const queue = [];
  const pump = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; pump(); });
  };
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump(); });
}
// Every free endpoint here throttles on a burst. The SERP overlay fires ~10
// domains at once, and the sidebar fires the same ~10 a moment later, and the
// UI re-tries in 1.8 s waves — so the *cumulative* request rate (not a single
// burst) trips a rolling-window quota and a subset comes back empty → "--".
// Verified live (Jun 2026): Ahrefs DR and SimilarWeb both return empty / 403
// under burst, then succeed again after a short cooldown. So cap EACH endpoint
// (not just Moz) and add jittered backoff in the cores below.
const mozLimit    = makeLimiter(4);   // Keywords Everywhere (DA / spam / BL)
const ahrefsLimit = makeLimiter(3);   // Ahrefs DR free
const swLimit     = makeLimiter(3);   // SimilarWeb traffic
const rdapLimit   = makeLimiter(4);   // RDAP age

// ─── Small helpers: sleep + retry-with-backoff ────────────────────
// `producer` must resolve to an object; we retry while `isRetryable(result)`
// is true (e.g. {ok:false}). Backoff grows and carries jitter so the retry
// waves from 10 parallel domains don't re-synchronise into a fresh burst.
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function withRetry(producer, { tries = 3, baseDelay = 700, isRetryable } = {}) {
  let last;
  for (let attempt = 0; attempt < tries; attempt++) {
    last = await producer();
    if (!isRetryable || !isRetryable(last)) return last;
    if (attempt < tries - 1) {
      const jitter = Math.floor(Math.random() * 400);
      await sleep(baseDelay * (attempt + 1) + jitter);
    }
  }
  return last;
}

// ─── Registrable ("root") domain ──────────────────────────────────
// RDAP cannot resolve sub-domains (qa.indeed.com → 404 verified), and
// SimilarWeb keys on the registrable domain too. Strip sub-domains down to
// eTLD+1, with a curated list of common two-level public suffixes so we don't
// over-truncate (e.g. ...com.qa, ...co.uk must keep three labels).
const TWO_LEVEL_TLDS = new Set([
  'co.uk','org.uk','me.uk','gov.uk','ac.uk','co.nz','co.za','co.in','net.in',
  'org.in','com.au','net.au','org.au','com.br','com.mx','com.ar','com.tr',
  'com.sg','com.my','com.ph','com.hk','com.tw','com.cn','com.qa','com.sa',
  'com.eg','com.kw','com.bh','com.om','com.pk','net.pk','org.pk','edu.pk',
  'gov.pk','fam.pk','biz.pk','web.pk','gob.pk','gok.pk','gkp.pk','gop.pk',
  'gos.pk','gog.pk','co.id','or.id','co.jp','ne.jp',
  'com.ng','com.gh','com.ua','co.il','com.co','com.pe','com.ec','com.do'
]);
function rootDomain(domain) {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '').replace(/\/.*$/, '').trim();
  const parts = d.split('.').filter(Boolean);
  if (parts.length <= 2) return d;
  const lastTwo = parts.slice(-2).join('.');
  if (TWO_LEVEL_TLDS.has(lastTwo)) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

// Core fetchers — return a result object (no sendResponse), so they can be
// shared via coalesce() and reused by both the overlay and the sidebar.
function parseDaHistoryValues(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(v => parseInt(v, 10)).filter(v => !Number.isNaN(v));
  }
  return String(raw).split('|').map(v => parseInt(v, 10)).filter(v => !Number.isNaN(v));
}

// Shared KE key reader for DA/Spam (Moz link-metrics) lookups — same
// chrome.storage.sync 'keApiKey' the Settings tab (Keywords Everywhere card)
// saves, so DA/Spam/traffic/volume all use the one key the user pastes in.
async function getMozApiKey() {
  try {
    const r = await chrome.storage.sync.get(['keApiKey', 'keEnabled']);
    if (r.keEnabled === false) return '';
    return (r.keApiKey || '').trim();
  } catch (_) {
    return '';
  }
}

// ── Keywords Everywhere domain link-metrics (Moz DA / PA / Spam / BL / RD) ──
// KE moved get-domain-link-metrics to linkmetrics.keywordseverywhere.com (the
// KE extension itself calls that host). The old data.* host no longer returns
// Moz metrics, which is why DA/Spam stayed "—" or fell through to the SEMrush
// fallback (fake DA 0 / Spam 0%). We now try the new host first, fall back to
// the old one, and retry with an empty key (public tier) if the saved key is
// rejected — same as the KE extension does when no key is set.
const KE_LINKMETRICS_ENDPOINTS = [
  'https://linkmetrics.keywordseverywhere.com/service/get-domain-link-metrics',
  'https://data.keywordseverywhere.com/service/get-domain-link-metrics'
];
const KE_CLIENT_VERSION = '11.55';   // KE extension version the API expects
let _keLinkEpIdx = 0;                // endpoint that worked last time
let _keLinkFailUntil = 0;            // short backoff when every endpoint failed
let _keLinkLastError = null;

async function keDomainLinkMetrics(domains, timeoutMs) {
  if (Date.now() < _keLinkFailUntil) return { rows: [], error: _keLinkLastError || 'backoff' };
  const userKey = await getMozApiKey();
  const keys = userKey ? [userKey, ''] : [''];
  const errors = [];
  let sawHardFailure = false; // network/HTTP errors only — NOT "no moz data" (that's often just an empty/invalid key)
  for (let e = 0; e < KE_LINKMETRICS_ENDPOINTS.length; e++) {
    const epIdx = (_keLinkEpIdx + e) % KE_LINKMETRICS_ENDPOINTS.length;
    const url = KE_LINKMETRICS_ENDPOINTS[epIdx];
    for (const apiKey of keys) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Accept': 'application/x.seometrics.v4+json', 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({ domains, country: 'us', version: KE_CLIENT_VERSION, num: 5000, api_key: apiKey }),
          signal: AbortSignal.timeout(timeoutMs || 12000)
        });
        if (!resp.ok) { errors.push(new URL(url).host + ' HTTP ' + resp.status); sawHardFailure = true; continue; }
        const raw = await resp.json();
        if (raw && !Array.isArray(raw) && raw.error) {
          errors.push(new URL(url).host + ' ' + (raw.message || raw.error)); continue;
        }
        const arr = Array.isArray(raw) ? raw : (raw && raw.data ? [raw] : []);
        const rows = arr.filter(row => {
          const r = row && (row.data || row);
          return r && !r.error && r.moz_domain_authority != null;
        });
        if (rows.length) { _keLinkEpIdx = epIdx; _keLinkLastError = null; return { rows }; }
        errors.push(new URL(url).host + ' no moz data');
      } catch (err) {
        // fetch() throws for network errors, missing host permission, CORS, abort/timeout, etc.
        errors.push(new URL(url).host + ' ' + (err && err.message || err));
        sawHardFailure = true;
      }
    }
  }
  _keLinkLastError = errors.join(' | ');
  // Only apply the cooldown after a genuine network/HTTP failure on EVERY
  // endpoint. If every endpoint simply responded with "no moz data" (e.g. the
  // free/no-key tier has no data for these domains), don't poison the next
  // batch in the same bulk-check run — let it try again immediately.
  if (sawHardFailure) _keLinkFailUntil = Date.now() + 20000;
  console.warn('[ShahzaibSEO] KE link-metrics failed:', _keLinkLastError);
  return { rows: [], error: _keLinkLastError };
}

function mozRowToResult(domain, r) {
  const n = (v) => (v != null ? Number(v) : null);
  return {
    ok: true,
    domain,
    domainAuthority: Math.round(r.moz_domain_authority),
    pageAuthority: Math.round(r.moz_page_authority ?? r.moz_domain_authority),
    spamScore: Math.max(0, Math.round(Number(r.moz_spam_score) || 0)),
    linkPropensity: r.moz_link_propensity != null ? Math.round(Number(r.moz_link_propensity)) : null,
    pageRank: n(r.page_rank),
    // Moz "pages linking to subdomain" family
    pagesToSubdomain: n(r.moz_pages_to_subdomain),
    nofollowPagesToSubdomain: n(r.moz_nofollow_pages_to_subdomain),
    redirectPagesToSubdomain: n(r.moz_redirect_pages_to_subdomain),
    deletedPagesToSubdomain: n(r.moz_deleted_pages_to_subdomain),
    externalPagesToSubdomain: n(r.moz_external_pages_to_subdomain),
    externalNofollowPagesToSubdomain: n(r.moz_external_nofollow_pages_to_subdomain),
    externalRedirectPagesToSubdomain: n(r.moz_external_redirect_pages_to_subdomain),
    rootDomainsToSubdomain: n(r.moz_root_domains_to_subdomain),
    nofollowRootDomainsToSubdomain: n(r.moz_nofollow_root_domains_to_subdomain),
    deletedRootDomainsToSubdomain: n(r.moz_deleted_root_domains_to_subdomain),
    // Prefer Moz root domains for RD; external pages is NOT true BL count
    referringDomains: r.moz_root_domains_to_subdomain != null ? Number(r.moz_root_domains_to_subdomain) : 0,
    backlinks: r.moz_external_pages_to_subdomain != null ? Number(r.moz_external_pages_to_subdomain) : 0,
    daHistoryValues: parseDaHistoryValues(r.moz_da_history_values),
    source: 'Keywords Everywhere'
  };
}

// v3 cache: v2 may hold poisoned "DA 0 / Spam 0" entries written by the old
// SEMrush fallback, so those are never read back.
const MOZ_CACHE_PREFIX = 'moz_v3_';
function mozCacheUsable(c) {
  return !!(c && c.ok && c.domainAuthority != null && c.source !== 'SEMrush');
}

async function semrushBacklinksFallback(domain) {
  try {
    const enc = encodeURIComponent(domain);
    const resp = await fetch('https://bl.publicapi.semrush.com/?url=https%3A%2F%2F' + enc + '%2F&ref=sq', {
      headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000)
    });
    if (resp.ok) {
      const xml = await resp.text();
      const bl = parseInt(xml.match(/<links_hostname>(\d+)/)?.[1] || xml.match(/<links>(\d+)/)?.[1] || '0') || 0;
      const rd = parseInt(xml.match(/<domains_hostname>(\d+)/)?.[1] || '0') || Math.max(1, Math.round(bl * 0.15));
      if (bl > 0 || rd > 0) {
        // SEMrush has NO DA / spam data → null (shows "—"), never a fake 0.
        return { ok: true, domain, domainAuthority: null, pageAuthority: null, spamScore: null, backlinks: bl, referringDomains: rd, source: 'SEMrush' };
      }
    }
  } catch (_) {}
  return null;
}

async function mozFetchCore(domain, opts = {}) {
  domain = String(domain || '').replace(/^www\./, '').toLowerCase().trim();
  const ck = MOZ_CACHE_PREFIX + domain;
  try {
    const cached = await getCachedData(ck);
    // Accept any real Moz result (including DA 0)
    if (mozCacheUsable(cached)) return cached;
  } catch (_) {}
  if (!opts.skipKE) {
    const { rows } = await keDomainLinkMetrics([domain], 10000);
    const row = rows.find(rw => String(rw.domain || '').replace(/^www\./, '').toLowerCase() === domain) || rows[0];
    if (row) {
      const result = mozRowToResult(domain, row.data || row);
      await setCachedData(ck, result, CONFIG.LONG_CACHE_TTL);
      return result;
    }
  }
  // SEMrush fallback (backlinks / ref domains only, not cached as Moz)
  return (await semrushBacklinksFallback(domain)) || { ok: false };
}

// Batch DA/spam/BL: KE accepts many domains in ONE request, so the sidebar's
// Top-10 table fetches all competitors at once instead of 10 separate calls.
async function mozBatchCore(domains) {
  const clean = [...new Set((domains || []).map(d => String(d || '').replace(/^www\./, '').toLowerCase().trim()).filter(Boolean))];
  const out = {};
  const need = [];
  for (const d of clean) {
    try {
      const cached = await getCachedData(MOZ_CACHE_PREFIX + d);
      if (mozCacheUsable(cached)) { out[d] = cached; continue; }
    } catch (_) {}
    need.push(d);
  }
  let keFailedEntirely = false;
  if (need.length) {
    const { rows } = await keDomainLinkMetrics(need, 12000);
    keFailedEntirely = rows.length === 0;
    for (const row of rows) {
      const dom = String((row && row.domain) || '').replace(/^www\./, '').toLowerCase();
      const r = row && (row.data || row);
      if (dom && r) {
        const result = mozRowToResult(dom, r);
        out[dom] = result;
        await setCachedData(MOZ_CACHE_PREFIX + dom, result, CONFIG.LONG_CACHE_TTL);
      }
    }
  }
  // Anything the batch didn't return → single path (skip KE if the whole KE
  // call just failed, so we don't repeat 6 failing requests per domain).
  await Promise.all(clean.filter(d => !out[d]).map(async d => {
    try { const single = await mozLimit(() => mozFetchCore(d, { skipKE: keFailedEntirely })); if (single && single.ok) out[d] = single; } catch (_) {}
  }));
  return { ok: true, results: out };
}

// ── Contact email extraction (public pages only: home + contact/about pages) ──
const contactLimit = makeLimiter(3);
const EMAIL_RE = /[a-z0-9][a-z0-9._%+\-]{0,63}@[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}/gi;
const EMAIL_BAD_TLD = new Set(['png','jpg','jpeg','gif','webp','svg','css','js','json','woff','woff2','ttf','eot','ico','avif','mp4','pdf','map','php','html','htm']);
const EMAIL_BAD_DOMAIN = /(^|\.)(sentry\.io|wixpress\.com|example\.(com|org|net)|domain\.com|email\.com|yourdomain\.com|yoursite\.com|mysite\.com|company\.com|test\.com|schema\.org|w3\.org)$/i;
const EMAIL_BAD_LOCAL = /^(your|you|name|user|username|email|test|example|johndoe|janedoe|john\.doe|jane\.doe|first|firstname|lastname|sample|noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|abuse)$/i;
const EMAIL_ROLE_LOCAL = /^(info|contact|hello|hi|support|sales|admin|office|editor|editorial|press|media|team|mail|enquiries|inquiries|enquiry|marketing|advertise|advertising|ads|partners|partnerships|webmaster|help|service|billing|careers|jobs|hr|news|submissions|pr|general|business|accounts)$/i;

function decodeCfEmail(hex) {
  try {
    const k = parseInt(hex.slice(0, 2), 16);
    let out = '';
    for (let i = 2; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ k);
    return out;
  } catch (_) { return ''; }
}

function normalizeHtmlForEmails(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/data-cfemail="([0-9a-f]+)"/gi, (m, h) => ' ' + decodeCfEmail(h) + ' ')
    .replace(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi, (m, h) => ' ' + decodeCfEmail(h) + ' ')
    .replace(/&#(\d{2,3});/g, (m, n) => { const c = +n; return c >= 32 && c < 127 ? String.fromCharCode(c) : m; })
    .replace(/&#x([0-9a-f]{2});/gi, (m, h) => { const c = parseInt(h, 16); return c >= 32 && c < 127 ? String.fromCharCode(c) : m; })
    .replace(/&commat;|\\u0040|%40/gi, '@')
    .replace(/&period;/gi, '.')
    .replace(/&amp;/gi, '&')
    .replace(/\s*[\[\(\{]\s*at\s*[\]\)\}]\s*/gi, '@')
    .replace(/\s*[\[\(\{]\s*dot\s*[\]\)\}]\s*/gi, '.');
}

function extractEmailsFromHtml(html) {
  const found = [];
  const t = normalizeHtmlForEmails(html);
  let m;
  EMAIL_RE.lastIndex = 0;
  while ((m = EMAIL_RE.exec(t))) {
    let e = m[0].toLowerCase().replace(/^u003[ce]/, '').replace(/^[._%+\-]+/, '');
    const at = e.lastIndexOf('@');
    if (at < 1) continue;
    const local = e.slice(0, at), dom = e.slice(at + 1);
    const tld = dom.split('.').pop();
    if (EMAIL_BAD_TLD.has(tld)) continue;
    if (EMAIL_BAD_DOMAIN.test(dom) || EMAIL_BAD_LOCAL.test(local)) continue;
    if (/^\d+x$|^[0-9a-f]{24,}$/.test(local) || /@\d+x\./.test(e)) continue; // image@2x, hashes
    found.push(e);
  }
  return found;
}

function findContactLinks(html, baseUrl) {
  const out = [];
  let baseRoot = '';
  try { baseRoot = rootDomain(new URL(baseUrl).hostname); } catch (_) { return out; }
  const re = /<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 24) {
    const href = m[1].trim();
    const txt = m[2].replace(/<[^>]+>/g, ' ').trim();
    if (/^(mailto|tel|javascript):/i.test(href)) continue;
    if (!/contact|kontakt|contacto|contatto|about|reach|get-in-touch|write-for-us|advertis|impressum|support|connect/i.test(href + ' ' + txt)) continue;
    try {
      const u = new URL(href, baseUrl);
      if (!/^https?:$/.test(u.protocol) || rootDomain(u.hostname) !== baseRoot) continue;
      u.hash = '';
      out.push(u.href);
    } catch (_) {}
  }
  const score = (u) => /contact|kontakt|contacto|contatto|get-in-touch/i.test(u) ? 0 : /write-for-us|advertis/i.test(u) ? 1 : /about/i.test(u) ? 2 : 3;
  return [...new Set(out)].sort((a, b) => score(a) - score(b));
}

async function fetchPageText(url, timeoutMs) {
  try {
    const r = await fetch(url, {
      redirect: 'follow', credentials: 'omit',
      headers: { 'Accept': 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(timeoutMs || 8000)
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (ct && !/html|xml|text/i.test(ct)) return null;
    const text = (await r.text()).slice(0, 1500000);
    return { text, url: r.url || url };
  } catch (_) { return null; }
}

async function contactEmailsCore(domain) {
  const root = rootDomain(domain);
  if (!root) return { ok: false, error: 'No domain' };
  const ck = 'contact_email_v1_' + root;
  try { const c = await getCachedData(ck); if (c && c.ok) return c; } catch (_) {}

  let home = null;
  for (const u of ['https://' + root + '/', 'https://www.' + root + '/', 'http://' + root + '/']) {
    home = await fetchPageText(u, 9000);
    if (home) break;
  }
  if (!home) return { ok: false, domain: root, error: 'Site unreachable' };

  const seen = new Set([home.url]);
  const found = new Map(); // email -> source url
  const add = (list, src) => { for (const e of list) if (!found.has(e)) found.set(e, src); };
  add(extractEmailsFromHtml(home.text), home.url);

  const origin = new URL(home.url).origin;
  const links = findContactLinks(home.text, home.url);
  let contactUrl = links.find(u => /contact|kontakt|contacto|contatto|get-in-touch/i.test(u)) || null;
  const queue = [...new Set([...links.slice(0, 3), origin + '/contact', origin + '/contact-us', origin + '/about', origin + '/about-us'])];
  let pages = 1;
  for (const u of queue) {
    if (pages >= 6 || found.size >= 4) break;
    if (seen.has(u)) continue;
    seen.add(u);
    const pg = await fetchPageText(u, 8000);
    if (!pg || seen.has(pg.url) && pg.url !== u) continue;
    seen.add(pg.url);
    pages++;
    add(extractEmailsFromHtml(pg.text), pg.url);
    if (!contactUrl && /contact|kontakt|contacto|contatto/i.test(pg.url)) contactUrl = pg.url;
  }

  const emails = [...found.entries()].map(([email, source]) => {
    const [local, dom] = email.split('@');
    return { email, source, onDomain: rootDomain(dom) === root, type: EMAIL_ROLE_LOCAL.test(local) ? 'role' : 'personal' };
  }).sort((a, b) => Number(b.onDomain) - Number(a.onDomain)).slice(0, 10);

  const result = { ok: true, domain: root, emails, contactUrl, pagesChecked: pages };
  try { await setCachedData(ck, result, CONFIG.LONG_CACHE_TTL); } catch (_) {}
  return result;
}

async function ahrefsDrCore(domain, opts = {}) {
  domain = rootDomain(domain);
  if (!domain) return { ok: false, error: 'no_domain' };
  const ck = 'ahrefs_dr_v2_' + domain;
  if (!opts.forceRefresh) {
    try {
      const cached = await getCachedData(ck);
      if (cached && cached.ok && cached.domainRating != null) return cached;
    } catch (_) {}
  }
  // Ahrefs free DR (APIv3 public endpoint). Key from Settings or built-in.
  // Rate limits under load → retry with backoff. Never cache hard failures.
  const apiKey = await getAhrefsApiKey();
  if (!apiKey) return { ok: false, error: 'no_api_key', needKey: true };

  const targets = [
    domain,
    'https://' + domain + '/',
    'https://www.' + domain + '/'
  ];

  const result = await withRetry(async () => {
    try {
      let lastErr = null;
      for (const t of targets) {
        const target = encodeURIComponent(t);
        const resp = await fetch(
          `https://api.ahrefs.com/v3/public/domain-rating-free?target=${target}&output=json`,
          {
            headers: {
              Accept: 'application/json',
              Authorization: 'Bearer ' + apiKey
            },
            signal: AbortSignal.timeout(12000)
          }
        );
        if (resp.status === 401 || resp.status === 403) {
          return { ok: false, error: 'auth_' + resp.status, needKey: true };
        }
        if (resp.status === 429) {
          lastErr = 429;
          continue;
        }
        if (!resp.ok) {
          lastErr = resp.status;
          continue;
        }
        const json = await resp.json().catch(() => ({}));
        const dr =
          json?.domain_rating?.domain_rating ??
          json?.domain_rating ??
          json?.domainRating ??
          null;
        if (dr != null && !Number.isNaN(Number(dr))) {
          return {
            ok: true,
            domain,
            domainRating: Math.round(Number(dr) * 10) / 10,
            source: 'Ahrefs Free API'
          };
        }
        lastErr = 'empty';
      }
      return { ok: false, error: String(lastErr || 'empty') };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }, {
    tries: 4,
    baseDelay: 700,
    isRetryable: r => !r || (!r.ok && r.error !== 'auth_401' && r.error !== 'auth_403' && !r.needKey)
  });

  if (result && result.ok) {
    try { await setCachedData(ck, result, CONFIG.LONG_CACHE_TTL); } catch (_) {}
  }
  return result || { ok: false, error: 'unknown' };
}


/** Keywords Everywhere domain traffic — same endpoint as official KE extension (FREE on SERP).
 *  POST https://data.keywordseverywhere.com/service/get-domain-metrics
 *  Body: { domains, country, version, num, api_key }
 *  Response item: { domain, data: { etv, etv_format, total_keywords, total_keywords_format } }
 */
async function fetchKeDomainTraffic(domain, apiKey, country) {
  const d = rootDomain(domain);
  if (!d) return null;
  const countryCode = String(country || 'us').toLowerCase().replace(/[^a-z]/g, '').slice(0, 5) || 'us';
  const resp = await fetch('https://data.keywordseverywhere.com/service/get-domain-metrics', {
    method: 'POST',
    headers: {
      'Accept': 'application/x.seometrics.v4+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      domains: [d],
      country: countryCode === 'uk' ? 'gb' : countryCode,
      version: '5.2.0',
      num: 5000,
      api_key: apiKey || ''
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error('KE domain metrics HTTP ' + resp.status + (errText ? ': ' + errText.slice(0, 120) : ''));
  }
  const json = await resp.json();
  // Official shape: [ { domain, data: { etv, etv_format, total_keywords, ... } } ]
  const rows = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
  let item = rows.find(r => r && rootDomain(r.domain || '') === d) || rows[0];
  if (!item) return null;
  const data = (item.data && typeof item.data === 'object' && !item.data.error) ? item.data : item;
  if (!data || data.error) return null;
  const candidates = [
    data.etv, data.ETV,
    data.estimated_monthly_traffic, data.estimatedMonthlyTraffic,
    data.estimated_traffic, data.estimatedTraffic,
    data.totalTraffic, data.total_traffic,
    data.traffic, data.organic_traffic, data.organicTraffic,
    data.visits, data.monthly_visits, data.monthlyVisits
  ];
  let visits = 0;
  for (const c of candidates) {
    const n = typeof c === 'string' ? parseFloat(String(c).replace(/,/g, '')) : Number(c);
    if (Number.isFinite(n) && n > 0) { visits = Math.round(n); break; }
  }
  if (!visits) return null;
  const kwCandidates = [
    data.total_keywords, data.totalKeywords,
    data.total_ranking_keywords, data.totalRankingKeywords,
    data.keywords_count, data.keywordsCount, data.keywords
  ];
  let keywords = null;
  for (const c of kwCandidates) {
    const n = typeof c === 'string' ? parseInt(String(c).replace(/,/g, ''), 10) : Number(c);
    if (Number.isFinite(n) && n >= 0) { keywords = Math.round(n); break; }
  }
  return {
    ok: true,
    visits,
    keywords,
    source: 'Keywords Everywhere',
    domain: d,
    etvFormat: data.etv_format || null
  };
}

/** Batch KE domain traffic — same official data.keywordseverywhere.com endpoint as KE extension */
async function fetchKeDomainTrafficBatch(domains, apiKey, country) {
  const list = [...new Set((domains || []).map(d => rootDomain(d)).filter(Boolean))];
  if (!list.length) return {};
  const countryCode = String(country || 'us').toLowerCase().replace(/[^a-z]/g, '').slice(0, 5) || 'us';
  const out = {};
  const CHUNK = 50;
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    try {
      const resp = await fetch('https://data.keywordseverywhere.com/service/get-domain-metrics', {
        method: 'POST',
        headers: {
          'Accept': 'application/x.seometrics.v4+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          domains: chunk,
          country: countryCode === 'uk' ? 'gb' : countryCode,
          version: '5.2.0',
          num: 5000,
          api_key: apiKey || ''
        }),
        signal: AbortSignal.timeout(20000)
      });
      if (!resp.ok) continue;
      const json = await resp.json();
      const rows = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const dom = rootDomain(row.domain || '');
        if (!dom) continue;
        const data = (row.data && typeof row.data === 'object' && !row.data.error) ? row.data : row;
        if (!data || data.error) continue;
        const visits = Math.round(Number(data.etv ?? data.ETV ?? data.estimated_monthly_traffic ?? data.estimatedMonthlyTraffic ?? 0)) || 0;
        if (!visits) continue;
        const keywordsRaw = data.total_keywords ?? data.totalKeywords ?? data.total_ranking_keywords;
        const keywords = keywordsRaw != null ? Math.round(Number(keywordsRaw)) : null;
        out[dom] = {
          ok: true,
          visits,
          keywords: Number.isFinite(keywords) ? keywords : null,
          source: 'Keywords Everywhere',
          domain: dom,
          etvFormat: data.etv_format || null
        };
      }
    } catch (_) {}
    if (i + CHUNK < list.length) await new Promise(r => setTimeout(r, 200));
  }
  return out;
}

async function trafficCore(domain, countryOpt) {
  const dRoot = rootDomain(domain);
  const ck = 'traffic_' + dRoot;
  let cachedFallback = null;
  let cfg = { keApiKey: '', keApiKeyTraffic: '', useTraffic: false };
  try { cfg = await getVolumeApiConfig(); } catch (_) {}

  // Effective KE traffic key: master enabled + Site traffic toggle + key present
  const trafficKey = (cfg.keApiKeyTraffic || '').trim()
    || ((cfg.useTraffic && cfg.keApiKey) ? String(cfg.keApiKey).trim() : '');

  try {
    const cached = await getCachedData(ck);
    if (cached?.ok && cached.visits > 0) {
      const src = String(cached.source || '');
      if (trafficKey) {
        // 1st priority: KE only when paid key + traffic enabled
        if (src === 'Keywords Everywhere') return cached;
        cachedFallback = cached;
      } else {
        // Free mode: prefer SimilarWeb cache; never hard-stick on SEMrush (always retry SW first)
        if (src === 'SimilarWeb') return cached;
        if (src === 'Keywords Everywhere') return cached; // free KE metrics ok
        cachedFallback = cached; // SEMrush etc. — soft only
      }
    }
  } catch (_) {}

  // ── Keywords Everywhere domain traffic (when key + feature enabled) ──
  if (trafficKey) {
    try {
      const country = String(countryOpt || 'us').toLowerCase().replace(/[^a-z]/g, '').slice(0, 5) || 'us';
      const ke = await fetchKeDomainTraffic(dRoot, trafficKey, country);
      if (ke && ke.ok && ke.visits > 0) {
        await setCachedData(ck, ke, CONFIG.CREDIT_CACHE_TTL || CONFIG.LONG_CACHE_TTL);
        return ke;
      }
    } catch (e) {
      console.warn('[TRAFFIC] KE domain traffic failed', e?.message || e);
    }
  }

  // Free path (no paid KE): 2) SimilarWeb  3) SEMrush  (then free KE metrics last)
  // Some networks/IPs get 403 from CloudFront — browser-like headers + retry help.
  const swDomain = rootDomain(domain);
  // Match Stat Layer background.js (proven working client)
  const swUrl = `https://data.similarweb.com/api/v1/data?domain=${encodeURIComponent(swDomain)}`;
  const swHeaderSets = [
    {
      Accept: '*/*',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'none',
      'Sec-GPC': '1',
      'x-extension-version': '6.12.14'
    },
    {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    }
  ];
  for (let attempt = 0; attempt < swHeaderSets.length; attempt++) {
   try {
    const swResp = await fetch(swUrl, {
      method: 'GET',
      headers: swHeaderSets[attempt],
      cache: 'no-cache',
      credentials: 'omit',
      signal: AbortSignal.timeout(12000)
    });
    // CloudFront 403 is permanent for this network — skip second SW attempt
    if (swResp.status === 403 || swResp.status === 401) { /* CloudFront IP block — free API often blocks datacenter/VPN IPs */ break; }
    if (swResp.ok) {
      const sw = await swResp.json();
      if (sw && (sw.GlobalRank || sw.Engagments || sw.EstimatedMonthlyVisits)) {
        let visits = null, visitsChangePercent = null;
        if (sw.EstimatedMonthlyVisits) {
          const entries = Object.entries(sw.EstimatedMonthlyVisits).sort(([a], [b]) => a.localeCompare(b));
          if (entries.length > 0) {
            visits = entries[entries.length - 1][1] || 0;
            if (entries.length >= 2) { const prev = entries[entries.length - 2][1]; if (prev > 0) visitsChangePercent = ((visits - prev) / prev * 100); }
          }
        } else if (sw.Engagments?.Visits) {
          visits = typeof sw.Engagments.Visits === 'string' ? parseInt(sw.Engagments.Visits.replace(/,/g, ''), 10) : sw.Engagments.Visits;
        }
        const ts = sw.TrafficSources || {};
        const result = {
          ok: true, source: 'SimilarWeb', visits, visitsChangePercent,
          bounceRate: sw.Engagments?.BounceRate ? parseFloat(sw.Engagments.BounceRate) : null,
          pagePerVisit: sw.Engagments?.PagePerVisit ? parseFloat(sw.Engagments.PagePerVisit) : null,
          timeOnSite: sw.Engagments?.TimeOnSite ? Math.round(parseFloat(sw.Engagments.TimeOnSite)) : null,
          globalRank: (() => {
            const g = sw.GlobalRank;
            if (g == null) return null;
            if (typeof g === 'object') {
              const r = g.Rank ?? g.rank ?? g.Value ?? g.value;
              return typeof r === 'number' ? r : (r != null && !isNaN(Number(r)) ? Number(r) : null);
            }
            return typeof g === 'number' ? g : (isNaN(Number(g)) ? null : Number(g));
          })(),
          countryCode: sw.CountryRank?.CountryCode || null,
          countryRank: (() => {
            const c = sw.CountryRank;
            if (c == null) return null;
            const r = typeof c === 'object' ? (c.Rank ?? c.rank) : c;
            return typeof r === 'number' ? r : (r != null && !isNaN(Number(r)) ? Number(r) : null);
          })(),
          category: sw.Category || null,
          categoryRank: (() => {
            const c = sw.CategoryRank;
            if (c == null) return null;
            if (typeof c === 'object') {
              const r = c.Rank ?? c.rank ?? c.Value ?? c.value;
              return typeof r === 'number' ? r : (r != null && !isNaN(Number(r)) ? Number(r) : null);
            }
            return typeof c === 'number' ? c : (isNaN(Number(c)) ? null : Number(c));
          })(),
          monthlyVisits: sw.EstimatedMonthlyVisits ? Object.entries(sw.EstimatedMonthlyVisits).sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([month, v]) => ({ month, visits: v || 0 })) : null,
          topCountryShares: sw.TopCountryShares ? sw.TopCountryShares.map(c => ({ CountryCode: c.CountryCode || String(c.Country), Value: c.Value })).sort((a, b) => b.Value - a.Value).slice(0, 8) : null,
          swTopKeywords: (sw.TopKeywords || []).slice(0, 10).map(k => ({
            keyword: k.Name || k.Keyword || k.name || '',
            volume: k.Volume || k.volume || null,
            cpc: k.Cpc || k.cpc || k.CPC || null,
            estimatedValue: k.EstimatedValue || k.estimatedValue || null
          })),
          trafficSources: {
            Direct: ts.Direct ?? null,
            Search: ts.Search ?? ts.SearchOrganic ?? null,
            Social: ts.Social ?? ts.SocialOrganic ?? null,
            Mail: ts.Mail ?? null,
            Referrals: ts.Referrals ?? null,
            Paid: ts.PaidReferrals ?? ts.SearchPaid ?? null,
            DisplayAds: ts.DisplayAds ?? null,
            GenAi: ts.GenAi ?? null
          },
          trafficDirect: ts.Direct ?? null,
          trafficSearch: ts.Search ?? null,
          trafficSocial: ts.Social ?? null,
          trafficReferrals: ts.Referrals ?? null
        };
        // Only accept SW when we have real monthly visits (2nd priority after KE)
        if (visits != null && Number(visits) > 0) {
          result.visits = Math.round(Number(visits));
          await setCachedData(ck, result, CONFIG.LONG_CACHE_TTL);
          return result;
        }
      }
    }
   } catch (_) {}
   if (attempt === 0) await sleep(700 + Math.floor(Math.random() * 300));
  }
  // ── 3rd: SEMrush public (only if SimilarWeb failed) ─────────────────────
  try {
    const enc = encodeURIComponent(rootDomain(domain));
    const resp = await fetch('https://seoquake.publicapi.semrush.com/info.php?url=https%3A%2F%2F' + enc + '%2F', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/xml, text/xml, */*'
      },
      signal: AbortSignal.timeout(9000)
    });
    if (resp.ok) {
      const xml = await resp.text();
      const traffic = parseInt(xml.match(/<traffic>(\d+)/)?.[1] || '0') || 0;
      const keywords = parseInt(xml.match(/<keywords>(\d+)/)?.[1] || '0') || 0;
      const rank = parseInt(xml.match(/<rank>(\d+)/)?.[1] || '0') || 0;
      if (traffic > 0) {
        const result = {
          ok: true,
          visits: traffic,
          keywords,
          globalRank: rank || null,
          source: 'SEMrush'
        };
        await setCachedData(ck, result, 5 * 60 * 1000);
        return result;
      }
    }
  } catch (_) {}

  // Soft fallback: prefer SimilarWeb over SEMrush if both were seen
  if (cachedFallback && cachedFallback.visits > 0) {
    const src = String(cachedFallback.source || '');
    if (src === 'SimilarWeb' || src === 'Keywords Everywhere' || src === 'SEMrush') {
      return cachedFallback;
    }
  }

  return {
    ok: false,
    visits: 0,
    reason: '1 KE → 2 SimilarWeb → 3 SEMrush all empty',
    source: null
  };
}

function getRdapLookupUrls(domain) {
  const parts = domain.split('.').filter(Boolean);
  const tld = (parts.pop() || '').toLowerCase();
  // For multi-part public suffixes (com.pk, co.uk) also try the two-level key
  const lastTwo = parts.length ? (parts[parts.length - 1] + '.' + tld).toLowerCase() : tld;
  const urls = [];
  const seen = new Set();
  const add = (base) => {
    if (!base) return;
    const u = base.endsWith('/') ? base + encodeURIComponent(domain) : base + encodeURIComponent(domain);
    if (seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };
  // Direct registry for exact TLD
  if (COMMON_RDAP_ENDPOINTS[tld]) add(COMMON_RDAP_ENDPOINTS[tld]);
  // Identity Digital covers many new gTLDs — try as secondary for unknown TLDs
  if (!COMMON_RDAP_ENDPOINTS[tld] || ['io','co','info','ai','me','xyz'].includes(tld)) {
    add('https://rdap.identitydigital.services/rdap/domain/');
  }
  // .co sometimes needs nic.co specifically
  if (tld === 'co') add('https://rdap.nic.co/domain/');
  // Generic bootstrap (slower, but broad coverage)
  add('https://rdap.org/domain/');
  // Alternate bootstrap
  add('https://rdap.verisign.com/com/v1/domain/'); // only helps .com — skipped if domain not .com by registry
  return urls;
}

async function waybackFirstSeen(domain) {
  // Fallback when RDAP has no data (common for .pk, some ccTLDs, new registries)
  try {
    const url = 'https://web.archive.org/cdx/search/cdx?url=' + encodeURIComponent(domain) +
      '&output=json&limit=1&fl=timestamp&filter=statuscode:200';
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    // [[timestamp], [YYYYMMDDhhmmss], ...]
    if (!Array.isArray(data) || data.length < 2) return null;
    const ts = String(data[1][0] || '');
    if (ts.length < 8) return null;
    const iso = ts.slice(0, 4) + '-' + ts.slice(4, 6) + '-' + ts.slice(6, 8);
    return iso;
  } catch (_) {
    return null;
  }
}

/** Normalize various date formats to YYYY-MM-DD */
function normalizeWhoisDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    // unix seconds or ms
    const ms = v > 1e12 ? v : v * 1000;
    try {
      return new Date(ms).toISOString().slice(0, 10);
    } catch (_) {
      return null;
    }
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}\/\d{2}\/\d{2}/.test(s)) return s.slice(0, 10).replace(/\//g, '-');
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)) {
    try {
      return new Date(s).toISOString().slice(0, 10);
    } catch (_) {
      return null;
    }
  }
  const t = Date.parse(s);
  if (!isNaN(t)) {
    try {
      return new Date(t).toISOString().slice(0, 10);
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * Registry web-WHOIS fallback for namespaces whose registry exposes a
 * browser-friendly query endpoint. This is used only for domain-age metadata;
 * it is deliberately separate from the port-43 WHOIS server shown in the UI.
 */
async function officialWebWhoisLookup(domain) {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '').trim();
  if (!d) return null;

  const targets = [];
  if (/\.co\.za$/i.test(d) || /\.(web|org|net)\.za$/i.test(d)) {
    targets.push({
      source: 'ZARC web WHOIS',
      url: 'https://whois.registry.net.za/whois/whois.sh?Domain=' + encodeURIComponent(d)
    });
  }

  for (const target of targets) {
    try {
      const resp = await fetch(target.url, {
        signal: AbortSignal.timeout(12000),
        headers: { Accept: 'text/plain,text/html;q=0.9,*/*;q=0.8' }
      });
      if (!resp.ok) continue;
      const text = await resp.text();
      if (!text || (/not found|no match|available/i.test(text) && !/Domain Name:/i.test(text))) continue;
      const pick = (re) => { const m = text.match(re); return m ? String(m[1] || '').trim() : null; };
      const created = normalizeWhoisDate(pick(/Creation Date:\s*([^\r\n]+)/i));
      const updated = normalizeWhoisDate(pick(/Updated Date:\s*([^\r\n]+)/i));
      const expires = normalizeWhoisDate(pick(/Registry Expiry Date:\s*([^\r\n]+)/i) || pick(/Registrar Registration Expiration Date:\s*([^\r\n]+)/i));
      const registrar = pick(/Registrar:\s*([^\r\n]+)/i);
      const status = (text.match(/Domain Status:\s*([^\r\n]+)/i) || [])[1];
      const nameservers = Array.from(text.matchAll(/(?:^|\n)\s*Name Server:\s*([^\s\r\n]+)/gi)).map(m => m[1]).filter(Boolean);
      if (created || expires || registrar || nameservers.length || status) {
        return {
          ok: true, createdDate: created, expirationDate: expires, updatedDate: updated,
          registrar: registrar || null, nameservers: nameservers.slice(0, 8),
          status: status ? [status.trim()] : [], cdnHint: detectCdnFromNameservers(nameservers),
          source: target.source
        };
      }
    } catch (_) {}
  }
  return null;
}

/**
 * PKNIC (.pk / .com.pk / …) has no public RDAP.
 * Use whois.vu (PKNIC-backed) then who-dat as fallbacks.
 */
async function pknicWhoisLookup(domain) {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '');
  if (!/\.pk$/i.test(d)) return null;

  // 1) api.whois.vu — returns PKNIC Creation / Expiry + NS
  try {
    const resp = await fetch('https://api.whois.vu/?q=' + encodeURIComponent(d), {
      signal: AbortSignal.timeout(12000),
      headers: { Accept: 'application/json' }
    });
    if (resp.ok) {
      const data = await resp.json();
      const created = normalizeWhoisDate(data.created);
      const expires = normalizeWhoisDate(data.expires);
      let nameservers = [];
      const whoisTxt = String(data.whois || '');
      const nsMatches = whoisTxt.match(/Name Server:\s*(\S+)/gi) || [];
      nameservers = nsMatches
        .map((line) => line.replace(/Name Server:\s*/i, '').trim().toLowerCase())
        .filter(Boolean);
      if (!nameservers.length && Array.isArray(data.nameservers)) {
        nameservers = data.nameservers.map((n) => (typeof n === 'string' ? n : n.name || '')).filter(Boolean);
      }
      if (created) {
        return {
          ok: true,
          createdDate: created,
          expirationDate: expires,
          nameservers: nameservers.slice(0, 6),
          registrar: 'PKNIC',
          cdnHint: detectCdnFromNameservers(nameservers),
          source: 'PKNIC'
        };
      }
    }
  } catch (_) {}

  // 2) who-dat.as93.net
  try {
    const resp = await fetch('https://who-dat.as93.net/' + encodeURIComponent(d), {
      signal: AbortSignal.timeout(12000),
      headers: { Accept: 'application/json' }
    });
    if (resp.ok) {
      const data = await resp.json();
      const created = normalizeWhoisDate(data.dates && data.dates.created);
      const expires = normalizeWhoisDate(data.dates && data.dates.expires);
      const nameservers = (data.nameservers || [])
        .map((n) => (typeof n === 'string' ? n : n.name || ''))
        .filter(Boolean);
      if (created) {
        return {
          ok: true,
          createdDate: created,
          expirationDate: expires,
          nameservers: nameservers.slice(0, 6),
          registrar: (data.registrar && data.registrar.name) || 'PKNIC',
          cdnHint: detectCdnFromNameservers(nameservers),
          source: 'PKNIC'
        };
      }
    }
  } catch (_) {}

  return null;
}

function isPkDomain(domain) {
  return /\.pk$/i.test(String(domain || ''));
}

async function rdapCore(domain) {
  // RDAP resolves registrable domains only — a sub-domain (qa.indeed.com)
  // 404s. Normalise to eTLD+1 so age populates for sub-domained results.
  const rd = rootDomain(domain);
  const ck = 'rdap_' + rd;
  try { const cached = await getCachedData(ck); if (cached?.ok) return cached; } catch (_) {}

  // .pk has no public RDAP — PKNIC path first
  if (isPkDomain(rd)) {
    try {
      const pk = await pknicWhoisLookup(rd);
      if (pk && pk.ok && pk.createdDate) {
        await setCachedData(ck, pk, CONFIG.LONG_CACHE_TTL);
        return pk;
      }
    } catch (_) {}
  }

  // Load IANA delegation metadata so uncommon ccTLDs (including .sa, .ae,
  // .qa and other country extensions) can use their published RDAP endpoint
  // when available, even if the TLD is not hard-coded above.
  let tldMeta = null;
  try {
    const tld = (rd.split('.').pop() || '').toLowerCase();
    tldMeta = await fetchIanaTldMeta(tld);
  } catch (_) {}

  const lookupUrls = getRdapLookupUrls(rd);
  if (tldMeta?.rdapServer) {
    const base = String(tldMeta.rdapServer).replace(/\/+$/, '') + '/domain/';
    const candidate = base + encodeURIComponent(rd);
    if (!lookupUrls.includes(candidate)) lookupUrls.unshift(candidate);
  }

  const result = await withRetry(async () => {
    let lastFailure = { ok: false };
    for (const url of lookupUrls) {
      try {
        const resp = await fetch(url, {
          headers: { 'Accept': 'application/rdap+json, application/json' }, signal: AbortSignal.timeout(10000)
        });
        if (!resp.ok) { lastFailure = { ok: false }; continue; }
        const data = await resp.json();
        const registrar = extractRdapRegistrar(data);
        const events = extractRdapEvents(data);
        if (!events.registration) { lastFailure = { ok: false }; continue; }
        const nameservers = (data.nameservers || []).map(n => n.ldhName || n.unicodeName || '').filter(Boolean);
        const cdnHint = detectCdnFromNameservers(nameservers);
        return { ok: true, registrar, nameservers: nameservers.slice(0, 8), cdnHint, createdDate: events.registration, expirationDate: events.expiration, updatedDate: events.updated, source: 'RDAP', tldMeta: tldMeta || null, whoisServer: tldMeta?.whoisServer || null, rdapServer: tldMeta?.rdapServer || null };
      } catch (e) { lastFailure = { ok: false }; }
    }
    return lastFailure;
  }, { tries: 2, baseDelay: 600, isRetryable: r => !r || !r.ok });

  if (result && result.ok) {
    await setCachedData(ck, result, CONFIG.LONG_CACHE_TTL);
    return result;
  }

  // PKNIC retry for multi-part (.com.pk etc.) if first path missed
  if (isPkDomain(rd)) {
    try {
      const pk = await pknicWhoisLookup(rd);
      if (pk && pk.ok && pk.createdDate) {
        await setCachedData(ck, pk, CONFIG.LONG_CACHE_TTL);
        return pk;
      }
    } catch (_) {}
  }

  // Registry-published web WHOIS endpoints (currently ZARC .ZA zones).
  // Prefer official registry output before third-party relay data.
  try {
    const official = await officialWebWhoisLookup(rd);
    if (official?.ok) {
      const merged = {
        ...official,
        tldMeta: tldMeta || null,
        whoisServer: tldMeta?.whoisServer || COMMON_WHOIS_SERVERS[(rd.split('.').pop() || '').toLowerCase()] || null,
        rdapServer: tldMeta?.rdapServer || null
      };
      await setCachedData(ck, merged, CONFIG.LONG_CACHE_TTL);
      return merged;
    }
  } catch (_) {}

  // Public HTTPS WHOIS relay fallback for registries that publish WHOIS but
  // do not publish an HTTP RDAP endpoint. This covers many ccTLDs such as
  // .sa, .ae and .qa. The UI labels this as a WHOIS relay, not an official
  // registry transport.
  try {
    const whois = await publicWhoisRelayLookup(rd);
    if (whois?.ok) {
      const merged = { ...whois, tldMeta: tldMeta || null, whoisServer: tldMeta?.whoisServer || COMMON_WHOIS_SERVERS[(rd.split('.').pop() || '').toLowerCase()] || null, rdapServer: tldMeta?.rdapServer || null };
      await setCachedData(ck, merged, CONFIG.LONG_CACHE_TTL);
      return merged;
    }
  } catch (_) {}

  // Wayback Machine fallback for TLDs without public RDAP/WHOIS relay data.
  try {
    const first = await waybackFirstSeen(rd);
    if (first) {
      const fb = { ok: true, createdDate: first, source: 'Wayback', registrar: null, nameservers: [], cdnHint: null, tldMeta: tldMeta || null, whoisServer: tldMeta?.whoisServer || null, rdapServer: tldMeta?.rdapServer || null };
      await setCachedData(ck, fb, CONFIG.LONG_CACHE_TTL);
      return fb;
    }
  } catch (_) {}

  if (tldMeta) {
    return {
      ok: true,
      createdDate: null,
      expirationDate: null,
      updatedDate: null,
      registrar: null,
      nameservers: [],
      cdnHint: null,
      source: 'IANA registry metadata',
      tldMeta,
      whoisServer: tldMeta.whoisServer || COMMON_WHOIS_SERVERS[(rd.split('.').pop() || '').toLowerCase()] || null,
      rdapServer: tldMeta.rdapServer || null
    };
  }
  return result || { ok: false };
}

// ─── Keyword Research App (real volume / trend / difficulty) ──────────────
// Free endpoint: GET /v1/keywords?keyword=<word> with an anonymous X-Client-Id
// (a UUID generated once and kept in storage.local). Returns REAL monthly
// volume + 12-month trend, replacing the SERP "~estimate". Rate limit is low
// (x-ratelimit-limit: 10), so results are cached hard and 429s fall back to
// whatever estimate the caller already showed.
async function getKraClientId() {
  try {
    const got = await chrome.storage.local.get('kra_client_id');
    if (got && got.kra_client_id) return got.kra_client_id;
  } catch (_) {}
  let id;
  try { id = crypto.randomUUID(); }
  catch (_) {
    id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  try { await chrome.storage.local.set({ kra_client_id: id }); } catch (_) {}
  return id;
}


// Google Ads geo-target ids for the SERP regions we support. Unknown country →
// worldwide (empty list), same as before.
const GT_GEO = { us:2840, gb:2826, uk:2826, pk:2586, in:2356, ca:2124, au:2036, de:2276, fr:2250, es:2724, it:2380, nl:2528, br:2076, mx:2484, jp:2392, sg:2702, ae:2784, sa:2682, za:2710, tr:2792, pl:2616, ie:2372, nz:2554, id:2360, ph:608, bd:50, my:2458, eg:2818, ng:2566 };

async function fetchGoTrendsVolume(query, country) {
  const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() - 1, 1);    // previous full month
  const start = new Date(end.getFullYear(), end.getMonth() - 11, 1); // 12-month window
  const geoId = GT_GEO[String(country || '').toLowerCase()];
  const attempts = geoId ? [['geoTargetConstants/' + geoId], []] : [[]];

  for (const geo of attempts) {
    for (let retry = 0; retry < 2; retry++) {
      try {
        const resp = await fetch('https://insight.gotrends.app/kw/gethistorymetric', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keywords: [query],
            includeAdultKeywords: true,
            geoTargetConstants: geo,
            aggregateMetrics: { aggregateMetricTypes: ['DEVICE'] },
            historicalMetricsOptions: {
              includeAverageCpc: true,
              yearMonthRange: {
                start: { year: String(start.getFullYear()), month: MONTHS[start.getMonth()] },
                end: { year: String(end.getFullYear()), month: MONTHS[end.getMonth()] }
              }
            },
            language: 'languageConstants/1000'
          }),
          signal: AbortSignal.timeout(12000)
        });
        if (resp.status === 429 || resp.status >= 500) {          // transient → one retry
          console.warn('[GoTrends] HTTP', resp.status, geo.length ? '(geo)' : '(worldwide)');
          await new Promise(r => setTimeout(r, 700));
          continue;
        }
        if (!resp.ok) { console.warn('[GoTrends] HTTP', resp.status); break; }
        const json = await resp.json();
        const m = json?.results?.[0]?.keywordMetrics;
        const volume = parseInt(m?.avgMonthlySearches) || 0;
        if (!m || volume <= 0) break;                              // try next attempt (worldwide)
        const cpc = m.averageCpcMicros ? parseFloat(m.averageCpcMicros) / 1000000 : 0;
        const compIndex = parseInt(m.competitionIndex) || 0;
        const difficulty = Math.min(100, Math.round(compIndex * 0.6 + (volume > 10000 ? 30 : volume > 1000 ? 15 : 5)));
        const titleCase = s => s ? (s.charAt(0) + s.slice(1).toLowerCase()) : s;
        const trend = Array.isArray(m.monthlySearchVolumes)
          ? m.monthlySearchVolumes.map(x => ({ month: titleCase(x.month), year: parseInt(x.year) || x.year, value: parseInt(x.monthlySearches) || 0 })).filter(t => t.month)
          : null;
        return {
          ok: true, volume, cpc, cpcCurrency: '$',
          competition: compIndex / 100, competitionIndex: compIndex,
          difficulty, trend, estimated: false,
          source: 'Google Keyword Planner' + (geo.length ? '' : ' (worldwide)')
        };
      } catch (e) {
        console.warn('[GoTrends] fetch failed:', e && e.message);
        if (retry === 0) await new Promise(r => setTimeout(r, 500));
      }
    }
  }
  return { ok: false };
}


// SBMM keyword endpoint — primary free volume source.
// Same request shape the SBMM extension uses: POST /api/extension/keyword {keyword, country}.
const SBMM_KW_URL = 'https://edu.sbmm.com.pk/api/extension/keyword';
async function getSbmmClientId() {
  try {
    const got = await chrome.storage.local.get('sbmm_client_id');
    // Prefer a real UUID — API accepted 00000000-0000-4000-8000-… style installs
    if (got && got.sbmm_client_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(got.sbmm_client_id)) {
      return got.sbmm_client_id;
    }
  } catch (_) {}
  let id;
  try {
    id = crypto.randomUUID();
  } catch (_) {
    // RFC4122-ish fallback
    id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  try { await chrome.storage.local.set({ sbmm_client_id: id }); } catch (_) {}
  return id;
}

async function fetchSbmmKeyword(query, country) {
  const kw = String(query || '').trim().slice(0, 120);
  if (!kw) return { ok: false };
  // Match the working curl shape: { keyword, country } + X-SBMM-Install UUID
  // Do NOT set User-Agent / AbortSignal.timeout — both break or get stripped in MV3 SW
  // and can turn a working request into {error:"forbidden"}.
  const glRaw = String(country || 'us').toLowerCase().replace(/[^a-z]/g, '').slice(0, 5) || 'us';
  const glVariants = [glRaw.toUpperCase(), glRaw]; // API often prefers "US"
  const clientId = await getSbmmClientId();
  let ver = 'rankseo';
  try { ver = 'rankseo-' + chrome.runtime.getManifest().version; } catch (_) {}

  for (const gl of glVariants) {
    try {
      const resp = await fetch(SBMM_KW_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SBMM-Install': clientId,
          'X-SBMM-Version': ver
        },
        body: JSON.stringify({ keyword: kw, country: gl })
      });
      // HTTP-level errors
      if (resp.status === 403 || resp.status === 429) {
        console.warn('[SBMM keyword] HTTP', resp.status, gl);
        return { ok: false, status: resp.status, rateLimited: resp.status === 429 || resp.status === 403 };
      }
      if (!resp.ok) {
        console.warn('[SBMM keyword] HTTP', resp.status, gl);
        continue;
      }
      let j = null;
      try { j = await resp.json(); } catch (_) { j = null; }
      if (!j) continue;

      // JSON error body (some nodes return 200 + {error:"forbidden"})
      if (j.error === 'forbidden' || j.error === 'rate_limit' || j.error === 'too_many_requests') {
        console.warn('[SBMM keyword] body error', j.error, gl);
        return { ok: false, status: 403, error: j.error, rateLimited: true };
      }
      // no_data → try next free source (GoTrends), do not cache as volume 0
      if (j.ok === false && (j.error === 'no_data' || j.error === 'not_found')) {
        return { ok: false, noData: true, status: 404 };
      }
      // Success: { ok:true, volume: number, ... }
      if (j.ok === true && typeof j.volume === 'number') {
        const volume = Number(j.volume) || 0;
        const ci = (j.competitionIndex != null) ? Number(j.competitionIndex) : null;
        const trend = Array.isArray(j.trend)
          ? j.trend.map(t => ({ month: t.month, year: t.year, value: Number(t.value) || 0 }))
          : null;
        return {
          ok: true,
          volume,
          cpc: j.cpc != null ? Number(j.cpc) : null,
          cpcCurrency: j.cpcCurrency || '$',
          competition: ci != null ? ci / 100 : null,
          competitionIndex: ci,
          difficulty: Math.min(100, Math.round((ci || 0) * 0.6 + (volume > 10000 ? 30 : volume > 1000 ? 15 : 5))),
          trend: trend && trend.length ? trend : null,
          estimated: false,
          source: 'Keyword Planner'
        };
      }
      // Alternate shape: volume at top-level without ok flag
      if (typeof j.volume === 'number' && j.volume > 0) {
        return {
          ok: true,
          volume: Number(j.volume),
          cpc: j.cpc != null ? Number(j.cpc) : null,
          cpcCurrency: j.cpcCurrency || '$',
          competitionIndex: j.competitionIndex != null ? Number(j.competitionIndex) : null,
          competition: null,
          difficulty: null,
          trend: Array.isArray(j.trend) ? j.trend : null,
          estimated: false,
          source: 'Keyword Planner'
        };
      }
    } catch (inner) {
      console.warn('[SBMM keyword] attempt failed:', inner && inner.message);
    }
  }
  return { ok: false };
}

async function kwResearchCore(query) {
  // Normalize exactly like the working reference extension: lowercase + trim
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { ok: false };
  const ck = 'kra_' + q.replace(/\s+/g, '_').slice(0, 80);
  try { const cached = await getCachedData(ck); if (cached?.ok) return cached; } catch (_) {}
  try {
    const clientId = await getKraClientId();
    // Match reference extension exactly: only X-Client-Id header, no Accept, no AbortSignal.
    // Extra headers trigger CORS preflight; AbortSignal.timeout can silently fail in SW context.
    const resp = await fetch('https://api.keywordresearchapp.com/v1/keywords?keyword=' + encodeURIComponent(q), {
      headers: { 'X-Client-Id': clientId }
    });
    if (resp.status === 429) {
      // Surface the rate-limit window so the UI can stay on its estimate quietly.
      let info = {};
      try { info = await resp.json(); } catch (_) {}
      return {
        ok: false, rateLimited: true,
        limit: info?.rate_limit?.limit ?? resp.headers.get('x-ratelimit-limit'),
        remaining: info?.rate_limit?.remaining ?? resp.headers.get('x-ratelimit-remaining'),
        resetAt: info?.rate_limit?.reset_at ?? resp.headers.get('x-ratelimit-reset')
      };
    }
    if (!resp.ok) return { ok: false, status: resp.status };
    const json = await resp.json();
    const m = json?.metrics;
    if (!m || m.volume == null) return { ok: false };
    const volume = parseInt(m.volume) || 0;
    const competition = (typeof m.ads_competition === 'number') ? m.ads_competition : null; // 0..1
    const competitionIndex = competition != null ? Math.round(competition * 100) : null;
    const cpc = (m.cpc && typeof m.cpc.value === 'number') ? m.cpc.value : null;
    const cpcCurrency = (m.cpc && m.cpc.currency) ? m.cpc.currency : '$';
    // The API's seo_difficulty is often null; derive a difficulty when missing
    // so the KD bar still moves, but mark whether it was real vs derived.
    let difficulty, difficultyReal = false;
    if (typeof m.seo_difficulty === 'number') { difficulty = Math.round(m.seo_difficulty); difficultyReal = true; }
    else {
      const ci = competitionIndex || 0;
      difficulty = Math.min(100, Math.round(ci * 0.6 + (volume > 10000 ? 30 : volume > 1000 ? 15 : 5)));
    }
    const trend = Array.isArray(m.trend)
      ? m.trend.map(t => ({ month: t.month, year: t.year, value: parseInt(t.value) || 0 })).filter(t => t.month)
      : null;
    const result = {
      ok: true, volume, cpc, cpcCurrency, competition, competitionIndex,
      difficulty, difficultyReal, trend, estimated: false, source: 'Keyword Research App'
    };
    await setCachedData(ck, result, CONFIG.KW_CACHE_TTL);
    return result;
  } catch (e) { return { ok: false, error: e && e.message }; }
}

// Best-effort "track" call (per spec: POST /v1/keywords/track). Fire-and-forget;
// failures are swallowed. NOTE: this path returned 404 in testing (Jun 2026),
// so it is wired to the documented shape but may be inactive server-side.
async function kwTrackCore(query) {
  const q = String(query || '').trim();
  if (!q) return { ok: false };
  try {
    const clientId = await getKraClientId();
    const resp = await fetch('https://api.keywordresearchapp.com/v1/keywords/track', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Client-Id': clientId },
      body: JSON.stringify({ keyword: q }),
      signal: AbortSignal.timeout(8000)
    });
    return { ok: resp.ok, status: resp.status };
  } catch (e) { return { ok: false, error: e && e.message }; }
}


// Used by slow Technical-tab endpoints: IP_GEO, DNS_LOOKUP,
// HTTP_HEADERS, CERT_LOOKUP, WAYBACK_CDX.  Survives SW restarts and
// popup close/reopen cycles.  Prefix all keys with 'pc_' to avoid
// collisions with other local storage keys.
async function getPersistentCache(key) {
  try {
    const storeKey = 'pc_' + key;
    const result = await chrome.storage.local.get(storeKey);
    const cached = result[storeKey];
    if (cached && cached.timestamp && Date.now() - cached.timestamp < cached.ttl) {
      return cached.data;
    }
  } catch (_) {}
  return null;
}

async function setPersistentCache(key, data, ttl = CONFIG.PERSISTENT_CACHE_TTL) {
  try {
    const storeKey = 'pc_' + key;
    await chrome.storage.local.set({ [storeKey]: { data, timestamp: Date.now(), ttl } });
  } catch (_) {}
}

async function clearPersistentCache(key) {
  try {
    await chrome.storage.local.remove('pc_' + key);
  } catch (_) {}
  // Also bust session cache
  try {
    await chrome.storage.session.remove(key);
  } catch (_) {}
}

// ─── Notification Helpers ─────────────────────────────────────────
function notifyPopup(url, status, data) {
  chrome.runtime.sendMessage({ action: 'pageSpeedResult', url, status, data }).catch(() => {});
}

// ─── PageSpeed API ─────────────────────────────────────────────────
async function backgroundFetchPageSpeed(targetUrl, tabId) {
  if (fetchingUrls.has(targetUrl)) return;
  const cached = await getCachedData(cacheKey('ps', targetUrl));
  if (cached) return;

  fetchingUrls.add(targetUrl);

  const vitals = {
    mobile: { score: null },
    desktop: { score: null },
    lcp: null, inp: null, cls: null,
    audits: {}
  };

  try {
    const apiKey = await getPageSpeedApiKey();
    
    if (!apiKey) {
      throw new Error('PageSpeed API key not configured');
    }

    // Mobile analysis
    const mobileUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&key=${apiKey}&strategy=mobile&category=performance`;
    
    let mobileRes;
    try {
      mobileRes = await fetch(mobileUrl);
    } catch (fetchError) {
      throw new Error(`Network error: ${fetchError.message}`);
    }

    if (!mobileRes.ok) {
      const errorText = await mobileRes.text().catch(() => 'Unknown error');
      throw new Error(`PageSpeed API error (${mobileRes.status}): ${errorText}`);
    }

    const mobileData = await mobileRes.json();
    if (mobileData.lighthouseResult) {
      const lh = mobileData.lighthouseResult;
      const a = lh.audits || {};

      vitals.mobile.score = Math.round((lh.categories?.performance?.score || 0) * 100);

      if (a['largest-contentful-paint']) vitals.lcp = a['largest-contentful-paint'].numericValue;
      if (a['interaction-to-next-paint']) vitals.inp = a['interaction-to-next-paint'].numericValue;
      else if (a['total-blocking-time']) vitals.inp = a['total-blocking-time'].numericValue;
      if (a['cumulative-layout-shift']) vitals.cls = a['cumulative-layout-shift'].numericValue;
      if (a['speed-index']) vitals.audits.speedIndex = a['speed-index'].numericValue;
      if (a['interactive']) vitals.audits.tti = a['interactive'].numericValue;
      if (a['first-contentful-paint']) vitals.audits.fcp = a['first-contentful-paint'].numericValue;
      if (a['total-byte-weight']?.numericValue) vitals.audits.totalByteWeight = a['total-byte-weight'].numericValue;
      if (a['unused-css-rules']?.details?.overallSavingsBytes) vitals.audits.unusedCssBytes = a['unused-css-rules'].details.overallSavingsBytes;
      if (a['unused-javascript']?.details?.overallSavingsBytes) vitals.audits.unusedJsBytes = a['unused-javascript'].details.overallSavingsBytes;
    }

    notifyPopup(targetUrl, 'mobile-done', vitals);

    // Desktop analysis
    const desktopUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&key=${apiKey}&strategy=desktop&category=performance`;
    const desktopRes = await fetch(desktopUrl);

    if (desktopRes.ok) {
      const desktopData = await desktopRes.json();
      if (desktopData.lighthouseResult) {
        vitals.desktop.score = Math.round((desktopData.lighthouseResult.categories?.performance?.score || 0) * 100);
      }
    }

    await setCachedData(cacheKey('ps', targetUrl), { status: 'complete', vitals, timestamp: Date.now(), ttl: CONFIG.CACHE_TTL });
    notifyPopup(targetUrl, 'complete', vitals);

  } catch (e) {
    // Network or API error - this is expected and handled gracefully
    console.warn('[RP] PageSpeed API unavailable:', e.message || 'Network error');
    await setCachedData(cacheKey('ps', targetUrl), { status: 'error', vitals, timestamp: Date.now(), ttl: CONFIG.CACHE_TTL });
    notifyPopup(targetUrl, 'error', vitals);
  } finally {
    fetchingUrls.delete(targetUrl);
  }
}

// ─── Message Handlers ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  // Multi-SERP actions are handled by the dedicated listener below.
  // Must NOT take the messageHandlers lock or they get stuck as "busy".
  if (msg && msg.action && String(msg.action).startsWith('RS_SERP_')) {
    return; // fall through to multi-serp listener
  }

  // Niche background jobs have their own listener — do NOT lock or the
  // first NICHE_JOB_STATUS never cleans up and every later poll returns busy.
  if (msg && msg.action && String(msg.action).startsWith('NICHE_JOB_')) {
    return; // fall through to niche job listener
  }

  // Prevent duplicate message processing.
  // If an identical request is already in flight, try to serve from cache
  // first before declaring "busy". This handles the case where the popup is
  // closed and quickly re-opened while a slow API call (e.g. crt.sh,
  // archive.org) is still running in the background.
  //
  // For CERT_LOOKUP we include the subdomains flag in the key so a domain
  // lookup and a subdomain lookup can run concurrently.
  const subSuffix = (msg.action === 'CERT_LOOKUP' && msg.subdomains === true) ? '_sub' : '';
  // Include query + country so multi-niche volume (same keyword, different gl)
  // does not share one lock and return busy for every market after the first.
  const handlerKey = `${msg.action}_${msg.url || msg.domain || msg.keyword || msg.query || msg.seed || ''}_${msg.country || msg.gl || ''}${subSuffix}`;
  // Discover status/pause/resume/stop must never be blocked by busy-lock
  const skipBusy = msg && msg.action && (String(msg.action).startsWith('NICHE_DISCOVER') || String(msg.action).startsWith('NICHE_BATCH'));
  if (!skipBusy && messageHandlers.has(handlerKey)) {
    // Try to serve from cache before returning busy
    (async () => {
      try {
        const ck = deriveCacheKeyFromMsg(msg);
        const cached = ck ? await getCachedData(ck) : null;
        if (cached?.ok) {
          sendResponse(cached);
        } else {
          sendResponse({ ok: false, busy: true });
        }
      } catch (_) {
        sendResponse({ ok: false, busy: true });
      }
    })();
    return true; // async response
  }
  messageHandlers.set(handlerKey, true);

  const cleanup = () => messageHandlers.delete(handlerKey);

  // ── Meta Tags Fetch ─────────────────────────────────────────────
  if (msg.action === 'FETCH_HTACCESS') {
    fetch(msg.origin + '/.htaccess')
      .then(r => {
        if (r.status === 403) return sendResponse({ ok: false, status: 403, protected: true });
        if (!r.ok) return sendResponse({ ok: false, status: r.status, protected: false });
        return r.text().then(text => sendResponse({ ok: true, text, status: r.status }));
      })
      .catch(() => sendResponse({ ok: false, status: 0, protected: false }));
    return true;
  }

  if (msg.action === 'FETCH_SITEMAP') {
    const urls = [msg.origin + '/sitemap.xml', msg.origin + '/sitemap_index.xml'];
    (async () => {
      for (const url of urls) {
        try {
          const r = await fetch(url);
          if (r.ok) {
            const text = await r.text();
            sendResponse({ ok: true, text: text.slice(0, 4000), url });
            cleanup();
            return;
          }
        } catch (_) {}
      }
      sendResponse({ ok: false, text: null });
      cleanup();
    })();
    return true;
  }

  // ── SERP Pages Count: sitemap se total URLs count karo ──────────────────────
  if (msg.action === 'FETCH_SITEMAP_PAGES') {
    const domainRaw = String(msg.domain || '').replace(/^www\./i, '').toLowerCase().trim();
    if (!domainRaw) {
      sendResponse({ ok: false, pages: null, reason: 'no domain' });
      return false;
    }

    // Apex + www variants (many sites only list sitemap on one host)
    const hosts = [domainRaw, 'www.' + domainRaw];

    async function robotsSitemaps(origin) {
      const out = [];
      try {
        if (isRestrictedFetchUrl(origin + '/robots.txt')) return out;
        const r = await fetch(origin + '/robots.txt', {
          signal: AbortSignal.timeout(5000),
          headers: { 'Accept': 'text/plain,*/*' }
        });
        if (r.ok) {
          const txt = await r.text();
          const lines = txt.match(/^\s*Sitemap:\s*(.+)$/gim) || [];
          lines.forEach(l => {
            const u = l.replace(/^\s*Sitemap:\s*/i, '').trim();
            if (u && /^https?:\/\//i.test(u) && !out.includes(u)) out.push(u);
          });
        }
      } catch (_) {}
      return out;
    }

    function pathFallbacks(origin) {
      return [
        origin + '/sitemap.xml',
        origin + '/sitemap_index.xml',
        origin + '/sitemap-index.xml',
        origin + '/wp-sitemap.xml',
        origin + '/sitemap.xml.gz',
        origin + '/sitemap_index.xml.gz',
        origin + '/post-sitemap.xml',
        origin + '/page-sitemap.xml',
        origin + '/product-sitemap.xml',
        origin + '/sitemap1.xml',
        origin + '/sitemaps/sitemap.xml',
        origin + '/sitemap/sitemap.xml',
        origin + '/news-sitemap.xml',
        origin + '/video-sitemap.xml',
        origin + '/image-sitemap.xml'
      ];
    }

    async function getSitemapCandidates() {
      const candidates = [];
      const seen = new Set();
      const add = (u) => {
        if (!u) return;
        const key = u.replace(/\/$/, '').toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push(u);
      };

      // robots.txt from both hosts (parallel)
      const robotLists = await Promise.all(
        hosts.map(h => robotsSitemaps('https://' + h))
      );
      robotLists.flat().forEach(add);

      // Common paths on both hosts
      hosts.forEach(h => pathFallbacks('https://' + h).forEach(add));

      return candidates;
    }

    function parseCount(xml) {
      // Sitemap index
      const sitemapLocs = [...xml.matchAll(/<sitemap[\s>][\s\S]*?<loc>\s*([^<]+?)\s*<\/loc>/gi)]
        .map(m => m[1].trim()).filter(Boolean);
      if (sitemapLocs.length > 0) return { type: 'index', locs: sitemapLocs };

      const urlCount = (xml.match(/<url[\s>]/gi) || []).length;
      if (urlCount > 0) return { type: 'urlset', count: urlCount };

      // Some sitemaps only use <loc> without <url>
      const locCount = (xml.match(/<loc>/gi) || []).length;
      if (locCount > 0) return { type: 'urlset', count: locCount };

      return { type: 'urlset', count: 0 };
    }

    async function fetchText(url, timeoutMs) {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs || 7000),
        headers: {
          'Accept': 'application/xml,text/xml,application/gzip,*/*',
          'User-Agent': 'Mozilla/5.0 (compatible; ShahzaibSEO/5.5; +https://rankseo.app)'
        },
        redirect: 'follow'
      });
      if (!r.ok) return null;
      // Skip HTML error pages
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('text/html') && !ct.includes('xml')) {
        const peek = (await r.clone().text()).slice(0, 200).toLowerCase();
        if (peek.includes('<html') || peek.includes('<!doctype')) return null;
      }
      return await r.text();
    }

    async function countPages(sitemapUrl, depth) {
      if (depth > 2) return 0;
      try {
        let xml = await fetchText(sitemapUrl, depth === 0 ? 8000 : 6000);
        if (!xml || xml.length < 40) return 0;

        // Naive .gz: if still binary-looking, skip (service worker can't gunzip easily)
        if (sitemapUrl.endsWith('.gz') && xml.charCodeAt(0) === 0x1f) return 0;

        const parsed = parseCount(xml);
        if (parsed.type === 'index') {
          const locs = parsed.locs.slice(0, 20);
          const counts = await Promise.all(locs.map(u => countPages(u, depth + 1)));
          let total = counts.reduce((a, b) => a + b, 0);
          if (parsed.locs.length > 20 && total > 0) {
            total = Math.round(total * parsed.locs.length / 20);
          }
          return total;
        }
        return parsed.count || 0;
      } catch (_) {
        return 0;
      }
    }

    (async () => {
      try {
        const candidates = await getSitemapCandidates();
        // Wave 1: try first 8 in parallel (robots + top paths)
        const wave1 = candidates.slice(0, 8);
        const results1 = await Promise.all(wave1.map(async (url) => {
          const pages = await countPages(url, 0);
          return pages > 0 ? { url, pages } : null;
        }));
        const hit1 = results1.find(Boolean);
        if (hit1) {
          sendResponse({ ok: true, pages: hit1.pages, source: 'sitemap', sitemapUrl: hit1.url });
          return;
        }

        // Wave 2: remaining candidates sequentially (avoid hammering)
        for (const url of candidates.slice(8)) {
          const pages = await countPages(url, 0);
          if (pages > 0) {
            sendResponse({ ok: true, pages, source: 'sitemap', sitemapUrl: url });
            return;
          }
        }

        sendResponse({ ok: false, pages: null, reason: 'no sitemap found' });
      } catch (err) {
        sendResponse({ ok: false, pages: null, reason: err.message || 'error' });
      }
    })();
    return true;
  }

  // ── Sitemap URL List: internal-link suggester ke liye actual URLs fetch karo ──
  if (msg.action === 'FETCH_SITEMAP_URLS') {
    const origin = msg.origin;
    const maxUrls = msg.maxUrls || 80;

    async function getSitemapCandidatesForUrls() {
      const candidates = [];
      try {
        if (origin && isRestrictedFetchUrl(origin + '/robots.txt')) return candidates;
        const r = await fetch(origin + '/robots.txt', { signal: AbortSignal.timeout(4000) });
        if (r.ok) {
          const txt = await r.text();
          const lines = txt.match(/^Sitemap:\s*(.+)$/gim) || [];
          lines.forEach(l => {
            const u = l.replace(/^Sitemap:\s*/i, '').trim();
            if (u && !candidates.includes(u)) candidates.push(u);
          });
        }
      } catch (_) {}
      const fallbacks = [
        origin + '/sitemap.xml',
        origin + '/sitemap_index.xml',
        origin + '/wp-sitemap.xml',
        origin + '/post-sitemap.xml',
        origin + '/page-sitemap.xml',
      ];
      fallbacks.forEach(u => { if (!candidates.includes(u)) candidates.push(u); });
      return candidates;
    }

    // XML se URL list extract karo (regex-based, no DOMParser in SW)
    function extractUrls(xml) {
      // Sitemap index → sub-sitemap locs
      const indexLocs = [...xml.matchAll(/<sitemap[\s>][\s\S]*?<loc>([\s\S]*?)<\/loc>/gi)]
        .map(m => m[1].trim()).filter(Boolean);
      if (indexLocs.length > 0) return { type: 'index', locs: indexLocs };
      // Regular sitemap → page urls
      const pageUrls = [...xml.matchAll(/<url[\s>][\s\S]*?<loc>([\s\S]*?)<\/loc>/gi)]
        .map(m => m[1].trim()).filter(Boolean);
      return { type: 'urlset', urls: pageUrls };
    }

    async function fetchUrls(sitemapUrl, depth, collected) {
      if (depth > 2 || collected.length >= maxUrls) return;
      try {
        const r = await fetch(sitemapUrl, {
          signal: AbortSignal.timeout(6000),
          headers: { 'Accept': 'application/xml, text/xml, */*' }
        });
        if (!r.ok) return;
        const xml = await r.text();
        if (!xml || xml.length < 50) return;
        const parsed = extractUrls(xml);
        if (parsed.type === 'index') {
          const locs = parsed.locs.slice(0, 10);
          for (const loc of locs) {
            if (collected.length >= maxUrls) break;
            await fetchUrls(loc, depth + 1, collected);
          }
        } else {
          for (const u of parsed.urls) {
            if (collected.length >= maxUrls) break;
            if (!collected.includes(u)) collected.push(u);
          }
        }
      } catch (_) {}
    }

    (async () => {
      try {
        const candidates = await getSitemapCandidatesForUrls();
        const collected = [];
        for (const candidate of candidates) {
          if (collected.length >= maxUrls) break;
          await fetchUrls(candidate, 0, collected);
          if (collected.length > 0) break; // first working sitemap use karo
        }
        if (collected.length > 0) {
          sendResponse({ ok: true, urls: collected });
        } else {
          sendResponse({ ok: false, urls: [] });
        }
      } catch (err) {
        sendResponse({ ok: false, urls: [] });
      }
      cleanup();
    })();
    return true;
  }

  if (msg.action === 'FETCH_LLMS_TXT') {
    fetch(msg.origin + '/llms.txt')
      .then(r => {
        if (!r.ok) return sendResponse({ ok: false, text: null });
        return r.text().then(text => sendResponse({ ok: true, text }));
      })
      .catch(() => sendResponse({ ok: false, text: null }));
    cleanup();
    return true;
  }

  if (msg.action === 'FETCH_ROBOTS') {
    const origin = String(msg.origin || '');
    if (!origin || isRestrictedFetchUrl(origin + '/robots.txt')) {
      sendResponse({ ok: false, text: null, blocked: true });
      cleanup();
      return true;
    }
    fetch(origin + '/robots.txt')
      .then(r => r.ok ? r.text() : null)
      .then(text => sendResponse({ ok: true, text }))
      .catch(() => sendResponse({ ok: false, text: null }));
    cleanup();
    return true;
  }

  // ── Health Checks ────────────────────────────────────────────────
  if (msg.action === 'CHECK_LLMS') {
    const origin = String(msg.origin || '');
    if (!origin || isRestrictedFetchUrl(origin + '/llms.txt')) {
      sendResponse({ exists: false, blocked: true });
      cleanup();
      return true;
    }
    fetch(origin + '/llms.txt', { method: 'HEAD' })
      .then(r => sendResponse({ exists: r.ok }))
      .catch(() => sendResponse({ exists: false }));
    cleanup();
    return true;
  }

  if (msg.action === 'CHECK_SITEMAP') {
    const origin = String(msg.origin || '');
    if (!origin || isRestrictedFetchUrl(origin + '/sitemap.xml')) {
      sendResponse({ exists: false, blocked: true });
      cleanup();
      return true;
    }
    fetch(origin + '/sitemap.xml', { method: 'HEAD' })
      .then(r => sendResponse({ exists: r.ok }))
      .catch(() => sendResponse({ exists: false }));
    cleanup();
    return true;
  }

  // ── MOZ Fetch ───────────────────────────────────────────────────
  if (msg.action === 'MOZ_FETCH') {
    const domain = (msg.domain || '').replace(/^www\./, '');
    coalesce('MOZ_FETCH:' + domain, async () => {
      // Cache-first OUTSIDE the limiter: once the SERP overlay has fetched a
      // domain, the sidebar's retry returns instantly instead of waiting behind
      // the KWE throttle queue.
      const cached = await getCachedData(MOZ_CACHE_PREFIX + domain.toLowerCase());
      if (mozCacheUsable(cached)) return cached;
      return mozLimit(() => mozFetchCore(domain));
    })
      .then(r => sendResponse(r || { ok: false }))
      .catch(() => sendResponse({ ok: false }))
      .finally(cleanup);
    return true;
  }

  // ── MOZ Batch Fetch (DA/spam/BL for many domains in one KWE call) ─
  if (msg.action === 'MOZ_FETCH_BATCH') {
    const domains = Array.isArray(msg.domains) ? msg.domains : [];
    const key = 'MOZ_BATCH:' + domains.map(d => String(d || '').replace(/^www\./, '').toLowerCase()).sort().join(',');
    coalesce(key, () => mozBatchCore(domains))
      .then(r => sendResponse(r || { ok: false, results: {} }))
      .catch(() => sendResponse({ ok: false, results: {} }))
      .finally(cleanup);
    return true;
  }

  if (msg.action === 'CLEAR_API_KEY_CACHE') {
    _keLinkFailUntil = 0; _keLinkLastError = null;
    _ahrefsApiKey = null;
    _pageSpeedApiKey = null;
    // Drop traffic + keyword-volume cache so SERP VOL/TR refresh with KE after key save
    (async () => {
      try {
        const all = await chrome.storage.local.get(null);
        const keys = Object.keys(all || {}).filter(k =>
          k.startsWith('traffic_') || k.startsWith('bulkvol_') || k.startsWith('kw_')
        );
        if (keys.length) await chrome.storage.local.remove(keys);
      } catch (_) {}
    })();
    sendResponse({ ok: true });
    cleanup();
    return true;
  }

  if (msg.action === 'MOZ_CLEAR_CACHE') {
    (async () => {
      try {
        const domain = (msg.domain || '').replace(/^www\./, '');
        _keLinkFailUntil = 0;
        // Moz cache lives in storage.local (getCachedData); session kept for legacy keys
        for (const area of [chrome.storage.local, chrome.storage.session]) {
          if (!area) continue;
          if (domain) {
            await area.remove(['moz_' + domain, 'moz_v2_' + domain, MOZ_CACHE_PREFIX + domain.toLowerCase()]).catch(() => {});
          } else {
            const all = await area.get(null).catch(() => ({}));
            const mozKeys = Object.keys(all || {}).filter(k => k.startsWith('moz_'));
            if (mozKeys.length > 0) await area.remove(mozKeys).catch(() => {});
          }
        }
        sendResponse({ ok: true });
        cleanup();
      } catch (e) { sendResponse({ ok: false }); cleanup(); }
    })();
    return true;
  }

  // ── Ahrefs DR Clear Cache ────────────────────────────────────────
  if (msg.action === 'AHREFS_CLEAR_CACHE') {
    (async () => {
      try {
        const domain = (msg.domain || '').replace(/^www\./, '');
        if (domain) {
          await chrome.storage.session.remove('ahrefs_dr_' + domain).catch(() => {});
        } else {
          const all = await chrome.storage.session.get(null).catch(() => ({}));
          const keys = Object.keys(all || {}).filter(k => k.startsWith('ahrefs_dr_'));
          if (keys.length > 0) await chrome.storage.session.remove(keys).catch(() => {});
        }
        sendResponse({ ok: true });
        cleanup();
      } catch (e) { sendResponse({ ok: false }); cleanup(); }
    })();
    return true;
  }

  // ── Ahrefs DR Fetch (Free endpoint, APIv3 key required) ──────────
  if (msg.action === 'AHREFS_DR_FETCH') {
    const domain = rootDomain(msg.domain || '');
    const force = !!msg.forceRefresh;
    coalesce('AHREFS_DR_FETCH:' + domain + (force ? ':f' : ''), () =>
      ahrefsLimit(() => ahrefsDrCore(domain, { forceRefresh: force }))
    )
      .then(r => sendResponse(r || { ok: false }))
      .catch(e => sendResponse({ ok: false, error: e?.message || 'error' }))
      .finally(cleanup);
    return true;
  }

  if (msg.action === 'FETCH_TEXT') {
    (async () => {
      try {
        const url = msg.url || '';
        if (!url || isRestrictedFetchUrl(url)) {
          sendResponse({ ok: false, blocked: true });
          cleanup();
          return;
        }
        const resp = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10000) });
        if (!resp.ok) { sendResponse({ ok: false }); cleanup(); return; }
        const text = await resp.text();
        sendResponse({ ok: true, text: text.slice(0, 500000) });
      } catch (_) {
        sendResponse({ ok: false });
      }
      cleanup();
    })();
    return true;
  }

  if (msg.action === 'FETCH_BLOB_URL') {
    (async () => {
      try {
        const url = msg.url || '';
        if (!url || isRestrictedFetchUrl(url)) {
          sendResponse({ ok: false, blocked: true });
          cleanup();
          return;
        }
        const resp = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(15000) });
        if (!resp.ok) { sendResponse({ ok: false }); cleanup(); return; }
        const buf = await resp.arrayBuffer();
        const ct = resp.headers.get('content-type') || 'application/octet-stream';
        // base64 data URL for small images only
        if (buf.byteLength > 8 * 1024 * 1024) { sendResponse({ ok: false, error: 'too large' }); cleanup(); return; }
        let binary = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const b64 = btoa(binary);
        sendResponse({ ok: true, dataUrl: 'data:' + ct + ';base64,' + b64 });
      } catch (_) {
        sendResponse({ ok: false });
      }
      cleanup();
    })();
    return true;
  }

  if (msg.action === 'CHECK_LINK_STATUS') {
    const url = msg.url || '';
    (async () => {
      try {
        if (!url || !/^https?:/i.test(url) || isRestrictedFetchUrl(url)) {
          sendResponse({ status: 0, error: true, blocked: true });
          cleanup();
          return;
        }
        // Background fetch with host_permissions bypasses page CORS.
        let status = 0, redirected = false, finalUrl = url;
        try {
          const head = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            credentials: 'omit',
            cache: 'no-store'
          });
          status = head.status;
          finalUrl = head.url || url;
          redirected = !!head.redirected || (finalUrl.split('#')[0] !== url.split('#')[0]);
        } catch (_) {
          try {
            const get = await fetch(url, {
              method: 'GET',
              redirect: 'follow',
              credentials: 'omit',
              cache: 'no-store',
              headers: { 'Range': 'bytes=0-0' }
            });
            status = get.status;
            finalUrl = get.url || url;
            redirected = !!get.redirected || (finalUrl.split('#')[0] !== url.split('#')[0]);
          } catch (_) {
            sendResponse({ status: 0, error: true, blocked: true });
            cleanup();
            return;
          }
        }
        sendResponse({ status, redirected, finalUrl, ok: status > 0 });
      } catch (_) {
        sendResponse({ status: 0, error: true });
      }
      cleanup();
    })();
    return true;
  }

  // Redirect chain for common URL variants (http/https, www/non-www, trailing slash)
  if (msg.action === 'CHECK_REDIRECT_CHAIN') {
    const startUrl = msg.url || '';
    (async () => {
      try {
        if (!startUrl || !/^https?:/i.test(startUrl)) {
          sendResponse({ ok: false, error: 'Open an http(s) page first' });
          return;
        }
        if (isRestrictedFetchUrl(startUrl)) {
          sendResponse({ ok: false, error: 'This URL cannot be checked (browser restricted)' });
          return;
        }
        let u;
        try { u = new URL(startUrl); } catch (_) {
          sendResponse({ ok: false, error: 'Invalid URL' });
          return;
        }
        const host = u.hostname;
        const bare = host.replace(/^www\./i, '');
        const path = u.pathname || '/';
        const search = u.search || '';
        const variants = [];
        const addVar = (href, label) => {
          try {
            const norm = new URL(href).href.split('#')[0];
            if (!variants.some(v => v.url === norm)) variants.push({ url: norm, label });
          } catch (_) {}
        };
        addVar(u.href, 'Current');
        addVar('https://' + bare + path + search, 'HTTPS non-www');
        addVar('https://www.' + bare + path + search, 'HTTPS www');
        addVar('http://' + bare + path + search, 'HTTP non-www');
        addVar('http://www.' + bare + path + search, 'HTTP www');
        if (path !== '/' && path.endsWith('/')) {
          addVar(u.protocol + '//' + host + path.replace(/\/$/, '') + search, 'No trailing slash');
        } else if (path !== '/') {
          addVar(u.protocol + '//' + host + path + '/' + search, 'With trailing slash');
        }

        const probe = async (href) => {
          const ctrl = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
            ? AbortSignal.timeout(12000)
            : undefined;
          const opts = { redirect: 'follow', credentials: 'omit', cache: 'no-store' };
          if (ctrl) opts.signal = ctrl;
          try {
            const res = await fetch(href, Object.assign({ method: 'HEAD' }, opts));
            const finalUrl = res.url || href;
            return {
              url: href,
              status: res.status,
              finalUrl,
              redirected: !!res.redirected || (finalUrl.split('#')[0] !== href.split('#')[0])
            };
          } catch (_) {
            try {
              const res = await fetch(href, Object.assign({
                method: 'GET',
                headers: { Range: 'bytes=0-0' }
              }, opts));
              const finalUrl = res.url || href;
              return {
                url: href,
                status: res.status,
                finalUrl,
                redirected: !!res.redirected || (finalUrl.split('#')[0] !== href.split('#')[0])
              };
            } catch (e2) {
              return {
                url: href,
                status: 0,
                finalUrl: href,
                redirected: false,
                error: true,
                errorMsg: (e2 && e2.message) ? String(e2.message).slice(0, 80) : 'fetch failed'
              };
            }
          }
        };

        const chains = [];
        for (const v of variants.slice(0, 6)) {
          const r = await probe(v.url);
          chains.push(Object.assign({ label: v.label }, r));
        }

        const okChains = chains.filter(c => c.status > 0 && !c.error);
        const finals = new Set(okChains.map(c => {
          try {
            const x = new URL(c.finalUrl || c.url);
            return (x.protocol + '//' + x.hostname + x.pathname).replace(/\/$/, '') || x.href;
          } catch (_) {
            return String(c.finalUrl || '').replace(/\/$/, '');
          }
        }));
        const hasHttpOk = okChains.some(c => /^http:/i.test(c.url));
        const notes = [];
        if (!okChains.length) {
          notes.push({
            tone: 'mid',
            text: 'Could not reach any variant (site may block HEAD/GET from extensions or use bot protection). Try again or check from an external redirect checker.'
          });
        } else if (finals.size <= 1) {
          notes.push({ tone: 'ok', text: 'Variants resolve to one final URL — good for ranking signals.' });
        } else {
          notes.push({
            tone: 'bad',
            text: 'Variants end on ' + finals.size + ' different addresses. Pick one and 301 the rest to it.'
          });
        }
        if (hasHttpOk) {
          notes.push({
            tone: 'mid',
            text: 'HTTP still responds. Prefer a permanent redirect (301/308) from HTTP to HTTPS.'
          });
        }

        sendResponse({ ok: true, chains, notes, startUrl });
      } catch (e) {
        sendResponse({ ok: false, error: (e && e.message) || 'Redirect check failed' });
      } finally {
        cleanup();
      }
    })();
    return true;
  }

  // ── Traffic Fetch ────────────────────────────────────────────────
  // Priority: Keywords Everywhere (if key) → SimilarWeb → free KE metrics → SEMrush
  if (msg.action === 'TRAFFIC_FETCH') {
    const domain = (msg.domain || '').replace(/^www\./, '');
    const country = String(msg.country || msg.gl || 'us').toLowerCase().slice(0, 5) || 'us';
    coalesce('TRAFFIC_FETCH:' + domain + ':' + country, () => swLimit(() => trafficCore(domain, country)))
      .then(r => sendResponse(r || { ok: false, visits: 0 }))
      .catch(() => sendResponse({ ok: false, visits: 0 }))
      .finally(cleanup);
    return true;
  }

  // ── Batch Traffic (SERP many domains at once via KE when key present) ──
  if (msg.action === 'TRAFFIC_BATCH') {
    (async () => {
      try {
        const domains = Array.isArray(msg.domains) ? msg.domains : [];
        const country = String(msg.country || msg.gl || 'us').toLowerCase().slice(0, 5) || 'us';
        const cfg = await getVolumeApiConfig();
        const results = {};
        const tKey = (cfg.keApiKeyTraffic || '').trim() || ((cfg.useTraffic && cfg.keApiKey) ? String(cfg.keApiKey).trim() : '');
        if (tKey && domains.length) {
          const map = await fetchKeDomainTrafficBatch(domains, tKey, country);
          for (const [dom, row] of Object.entries(map)) {
            results[dom] = row;
            try { await setCachedData('traffic_' + dom, row, CONFIG.CREDIT_CACHE_TTL || CONFIG.LONG_CACHE_TTL); } catch (_) {}
          }
        }
        // Fill gaps with free trafficCore (limited concurrency already in trafficCore path)
        const missing = [...new Set(domains.map(d => rootDomain(d)).filter(d => d && !results[d]))];
        const fillLimit = Math.min(Math.max(parseInt(msg.fillLimit, 10) || 15, 1), 100);
        await Promise.all(missing.slice(0, fillLimit).map(d => swLimit(async () => {
          try {
            const r = await trafficCore(d, country);
            if (r && r.ok && r.visits > 0) results[d] = r;
          } catch (_) {}
        })));
        const map = {};
        domains.forEach(d => { map[d] = rootDomain(d); });
        sendResponse({ ok: true, results, map });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e), results: {} });
      }
      cleanup();
    })();
    return true;
  }

  // ── Contact emails (bulk outreach helper) ──
  if (msg.action === 'CONTACT_EMAILS_FETCH') {
    const domain = String(msg.domain || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase().trim();
    coalesce('CONTACT_EMAILS:' + domain, () => contactLimit(() => contactEmailsCore(domain)))
      .then(r => sendResponse(r || { ok: false }))
      .catch(e => sendResponse({ ok: false, error: (e && e.message) || String(e) }))
      .finally(cleanup);
    return true;
  }

  // ── SEMrush Backlinks + organic keywords (public APIs, no key) ──
  if (msg.action === 'SEMRUSH_BACKLINKS_FETCH') {
    (async () => {
      try {
        const domain = rootDomain(msg.domain || '');
        if (!domain) { sendResponse({ ok: false, error: 'No domain' }); cleanup(); return; }
        const ck = 'sem_bl_v1_' + domain;
        try {
          const cached = await getCachedData(ck);
          if (cached?.ok) { sendResponse(cached); cleanup(); return; }
        } catch (_) {}
        const enc = encodeURIComponent(domain);
        let backlinks = null, refDomains = null, organicKeywords = null, semrushRank = null, organicTraffic = null;
        try {
          const blResp = await fetch('https://bl.publicapi.semrush.com/?url=https%3A%2F%2F' + enc + '%2F&ref=sq', {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/xml,text/xml,*/*' },
            signal: AbortSignal.timeout(9000)
          });
          if (blResp.ok) {
            const xml = await blResp.text();
            backlinks = parseInt(xml.match(/<links_hostname>(\d+)/)?.[1] || xml.match(/<links>(\d+)/)?.[1] || '0', 10) || 0;
            refDomains = parseInt(xml.match(/<domains_hostname>(\d+)/)?.[1] || xml.match(/<domains>(\d+)/)?.[1] || '0', 10) || 0;
          }
        } catch (_) {}
        try {
          const infoResp = await fetch('https://seoquake.publicapi.semrush.com/info.php?url=https%3A%2F%2F' + enc + '%2F', {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/xml,text/xml,*/*' },
            signal: AbortSignal.timeout(9000)
          });
          if (infoResp.ok) {
            const xml = await infoResp.text();
            organicKeywords = parseInt(xml.match(/<keywords>(\d+)/)?.[1] || '0', 10) || 0;
            organicTraffic = parseInt(xml.match(/<traffic>(\d+)/)?.[1] || '0', 10) || 0;
            semrushRank = parseInt(xml.match(/<rank>(\d+)/)?.[1] || '0', 10) || null;
          }
        } catch (_) {}
        const result = {
          ok: true,
          domain,
          backlinks,
          refDomains,
          organicKeywords,
          organicTraffic,
          semrushRank: semrushRank || null,
          source: 'SEMrush Public'
        };
        try { await setCachedData(ck, result, CONFIG.LONG_CACHE_TTL || 3600000); } catch (_) {}
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
      cleanup();
    })();
    return true;
  }

  // ── SEMrush Keywords ─────────────────────────────────────────────
  if (msg.action === 'SEMRUSH_KEYWORDS_FETCH') {
    (async () => {
      const domain = (msg.domain || '').replace(/^www\./, '');
      const ck = 'semrush_kw_' + domain;

      try {
        const cached = await getCachedData(ck);
        if (cached?.ok) {
          sendResponse(cached);
          cleanup();
          return;
        }
      } catch (_) {}

      try {
        const url = `https://www.semrush.com/website/${encodeURIComponent(domain)}/overview/`;
        const resp = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml'
          }
        });

        if (!resp.ok) {
          sendResponse({ ok: false });
          cleanup();
          return;
        }

        const html = await resp.text();
        const islandMatch = html.match(/<astro-island[^>]*props="([^"]+)"/);

        if (!islandMatch) {
          sendResponse({ ok: false });
          cleanup();
          return;
        }

        const decode = s => s.replace(/&quot;/g, '"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'");
        const props = JSON.parse(decode(islandMatch[1]));

        function unwrap(o) {
          if (Array.isArray(o) && o.length === 2) {
            if (o[0] === 0) return unwrap(o[1]);
            if (o[0] === 1) return Array.isArray(o[1]) ? o[1].map(unwrap) : o[1];
          }
          if (o && typeof o === 'object' && !Array.isArray(o)) {
            const n = {};
            for (const [k, v] of Object.entries(o)) n[k] = unwrap(v);
            return n;
          }
          return o;
        }

        const page = unwrap(props?.page);
        const data = unwrap(page?.data);
        const kwSeries = unwrap(data?.keywords?.series);

        const keywords = kwSeries && Array.isArray(kwSeries)
          ? kwSeries.slice(0, 100).map(k => ({
              keyword: unwrap(k.keyword),
              position: unwrap(k.position),
              searchVolume: unwrap(k.searchVolume),
              traffic: unwrap(k.traffic),
              cpc: unwrap(k.cpc)
            })).filter(k => k.keyword)
          : [];

        const result = { ok: true, keywords };
        await setCachedData(ck, result, CONFIG.CACHE_TTL);
        sendResponse(result);
        cleanup();
        return;

      } catch (e) {
        console.warn('[RP] SEMrush keywords error:', e.message);
        sendResponse({ ok: false });
        cleanup();
      }
    })();
    return true;
  }

  // ── SEMrush Competitors ──────────────────────────────────────────
  if (msg.action === 'SEMRUSH_COMPETITORS_FETCH') {
    (async () => {
      const domain = (msg.domain || '').replace(/^www\./, '');
      const ck = 'semrush_kw_' + domain;

      try {
        const cached = await getCachedData(ck);
        if (cached?.competitors?.length) {
          sendResponse({ ok: true, competitors: cached.competitors });
          cleanup();
          return;
        }
      } catch (_) {}

      sendResponse({ ok: false });
      cleanup();
    })();
    return true;
  }

  // ── RDAP Lookup ─────────────────────────────────────────────────
  if (msg.action === 'RDAP_LOOKUP') {
    const domain = (msg.domain || '').replace(/^www\./, '');
    coalesce('RDAP_LOOKUP:' + rootDomain(domain), () => rdapLimit(() => rdapCore(domain)))
      .then(r => sendResponse(r || { ok: false }))
      .catch(() => sendResponse({ ok: false }))
      .finally(cleanup);
    return true;
  }

  // ── PageSpeed ────────────────────────────────────────────────────
  if (msg.action === 'fetchPageSpeed') {
    (async () => {
      const cached = await getCachedData(cacheKey('ps', msg.url));
      if (cached?.status === 'complete') {
        sendResponse({ status: 'complete', vitals: cached.vitals });
        cleanup();
        return;
      }
      if (cached?.status === 'fetching') {
        sendResponse({ status: 'fetching', vitals: cached.vitals });
        cleanup();
        return;
      }
      sendResponse({ status: 'fetching', vitals: null });
      backgroundFetchPageSpeed(msg.url, msg.tabId);
      cleanup();
    })();
    return true;
  }

  if (msg.action === 'pageSpeedResult') {
    sendResponse && sendResponse({});
    cleanup();
    return false;
  }

  if (msg.action === 'updateScoreBadge') {
    const s = msg.score;
    const color = s >= 75 ? '#10b981' : s >= 50 ? '#f59e0b' : '#ef4444';
    const tabId = msg.tabId;
    if (tabId != null) {
      Promise.all([
        chrome.action.setBadgeText({ tabId, text: String(s) }).catch(() => {}),
        chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {})
      ]).catch(() => {});
    }
    sendResponse({ success: true });
    cleanup();
    return true;
  }

  // ── Firecrawl Handlers ───────────────────────────────────────────
  if (msg.action === 'FIRECRAWL_SCRAPE' || msg.action === 'FIRECRAWL_EXTRACT' || msg.action === 'FIRECRAWL_TEST' || msg.action === 'FIRECRAWL_SEARCH') {
    handleFirecrawl(msg, sendResponse, cleanup);
    return true;
  }
  if (msg.action === 'MONID_DISCOVER' || msg.action === 'MONID_RUN' || msg.action === 'MONID_DOMAIN_RATING' || msg.action === 'MONID_TEST') {
    handleMonid(msg, sendResponse, cleanup);
    return true;
  }

  // ── Keyword Overview ─────────────────────────────────────────────

async function getVolumeApiConfig() {
  try {
    const r = await chrome.storage.sync.get([
      'keApiKey', 'keEnabled', 'keUseVolume', 'keUseBulkVolume', 'keUseTraffic', 'keUseRelatedVol', 'keUseNicheVolume'
    ]);
    const key = (r.keApiKey || '').trim();
    // Master switch: default ON when key exists unless explicitly disabled
    const enabled = key ? (r.keEnabled !== false) : false;
    const flag = (v, def = true) => (v === undefined || v === null ? def : !!v);
    const useVolume = enabled && flag(r.keUseVolume, true);
    const useBulkVolume = enabled && flag(r.keUseBulkVolume, true);
    const useTraffic = enabled && flag(r.keUseTraffic, true);
    const useRelatedVol = enabled && flag(r.keUseRelatedVol, true);
    const useNicheVolume = enabled && flag(r.keUseNicheVolume, true);
    // SERP volume OR Niche Research volume both unlock KE keyword-volume API
    const volumeKeyOn = useVolume || useNicheVolume;
    return {
      keApiKey: key,
      keEnabled: enabled,
      keApiKeyVolume: volumeKeyOn ? key : '',
      keApiKeyBulk: useBulkVolume ? key : '',
      keApiKeyTraffic: useTraffic ? key : '',
      keApiKeyRelated: useRelatedVol ? key : '',
      useVolume,
      useBulkVolume,
      useTraffic,
      useRelatedVol,
      useNicheVolume
    };
  } catch (_) {
    return {
      keApiKey: '', keEnabled: false,
      keApiKeyVolume: '', keApiKeyBulk: '', keApiKeyTraffic: '', keApiKeyRelated: '',
      useVolume: false, useBulkVolume: false, useTraffic: false, useRelatedVol: false,
      useNicheVolume: false
    };
  }
}

/** Keywords Everywhere — uses user credits; honest real volume + 12-mo trend */
async function fetchKeywordsEverywhereVolume(query, apiKey, country = 'us') {
  const countryCode = String(country || 'us').toLowerCase().slice(0, 5);
  const currency = countryCode === 'gb' || countryCode === 'uk' ? 'gbp'
    : countryCode === 'au' ? 'aud'
    : countryCode === 'ca' ? 'cad'
    : countryCode === 'in' ? 'inr'
    : countryCode === 'de' || countryCode === 'at' || countryCode === 'ch' || countryCode === 'fr' || countryCode === 'es' || countryCode === 'it' || countryCode === 'nl' ? 'eur'
    : countryCode === 'pk' ? 'pkr'
    : 'usd';
  const resp = await fetch('https://api.keywordseverywhere.com/v1/get_keyword_data', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      country: countryCode === 'uk' ? 'gb' : countryCode,
      currency,
      dataSource: 'gkp',
      kw: [query]
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!resp.ok) throw new Error('KE HTTP ' + resp.status);
  const json = await resp.json();
  const item = Array.isArray(json.data) ? json.data[0] : (json.data || json);
  if (!item || typeof item !== 'object') return null;
  const volume = parseInt(item.vol ?? item.volume ?? item.search_volume, 10);
  const cpcVal = item.cpc?.value != null ? parseFloat(item.cpc.value) : (item.cpc != null ? parseFloat(item.cpc) : null);
  const trend = Array.isArray(item.trend) ? item.trend.map(t => ({
    month: t.month, year: t.year, value: t.value
  })) : null;
  // Always return when KE responded — even volume 0 (with trend/cpc when present)
  return {
    ok: true,
    volume: Number.isFinite(volume) ? volume : 0,
    cpc: Number.isFinite(cpcVal) ? cpcVal : null,
    cpcCurrency: item.cpc?.currency || (currency === 'usd' ? '$' : currency.toUpperCase()),
    competitionIndex: item.competition != null ? Math.round(Number(item.competition) * 100) : null,
    trend,
    estimated: false,
    source: 'Keywords Everywhere',
    keyword: String(item.keyword || query)
  };
}

/**
 * Keywords Everywhere bulk keyword volume (up to 100 kws per request).
 * Returns array of { keyword, volume, cpc, competitionIndex, trend }.
 * Uses 1 credit per keyword. Chunks to respect API max of 100.
 */
async function fetchKeBulkVolume(keywords, apiKey, country = 'us') {
  const list = (Array.isArray(keywords) ? keywords : [])
    .map(k => String(k || '').trim())
    .filter(k => k.length >= 1 && k.length <= 120);
  if (!list.length || !apiKey) return [];

  const countryCode = String(country || 'us').toLowerCase().slice(0, 5);
  const currency = countryCode === 'gb' || countryCode === 'uk' ? 'gbp'
    : countryCode === 'au' ? 'aud'
    : countryCode === 'ca' ? 'cad'
    : countryCode === 'in' ? 'inr'
    : countryCode === 'de' || countryCode === 'at' || countryCode === 'ch' ? 'eur'
    : 'usd';

  const CHUNK = 100;
  const all = [];

  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const resp = await fetch('https://api.keywordseverywhere.com/v1/get_keyword_data', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        country: countryCode === 'uk' ? 'gb' : countryCode,
        currency,
        dataSource: 'gkp',
        kw: chunk
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error('KE bulk HTTP ' + resp.status + (errText ? ': ' + errText.slice(0, 120) : ''));
    }
    const json = await resp.json();
    const rows = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
    for (const item of rows) {
      if (!item || typeof item !== 'object') continue;
      const keyword = String(item.keyword || item.kw || '').trim();
      if (!keyword) continue;
      const volume = parseInt(item.vol ?? item.volume ?? item.search_volume, 10);
      const cpcVal = item.cpc?.value != null
        ? parseFloat(item.cpc.value)
        : (item.cpc != null ? parseFloat(item.cpc) : null);
      const competitionIndex = item.competition != null
        ? Math.round(Number(item.competition) * 100)
        : null;
      const trend = Array.isArray(item.trend)
        ? item.trend.map(t => ({ month: t.month, year: t.year, value: t.value }))
        : null;
      all.push({
        keyword,
        volume: Number.isFinite(volume) ? volume : 0,
        cpc: Number.isFinite(cpcVal) ? cpcVal : null,
        cpcCurrency: item.cpc?.currency || (currency === 'usd' ? '$' : currency.toUpperCase()),
        competitionIndex,
        trend,
        estimated: false,
        source: 'Keywords Everywhere'
      });
    }
    // Small pause between chunks to be polite to the API
    if (i + CHUNK < list.length) {
      await new Promise(r => setTimeout(r, 350));
    }
  }

  // Ensure every requested keyword appears (API may omit zero-volume or unknown)
  const byKw = {};
  all.forEach(r => { byKw[r.keyword.toLowerCase()] = r; });
  return list.map(kw => byKw[kw.toLowerCase()] || {
    keyword: kw,
    volume: 0,
    cpc: null,
    competitionIndex: null,
    trend: null,
    estimated: false,
    source: 'Keywords Everywhere'
  });
}

/**
 * Unofficial Google Trends interest-over-time (0–100).
 * Two-step: /trends/api/explore → token → /trends/api/widgetdata/multiline
 * May fail with 429 from some IPs; UI falls back to Open in Google Trends.
 */
async function fetchGoogleTrendsInterest(keyword, geo = '', timeframe = 'today 12-m') {
  const kw = String(keyword || '').trim();
  if (!kw) return null;
  const reqObj = {
    comparisonItem: [{ keyword: kw, geo: geo || '', time: timeframe }],
    category: 0,
    property: ''
  };
  const exploreUrl =
    'https://trends.google.com/trends/api/explore?hl=en-US&tz=0&req=' +
    encodeURIComponent(JSON.stringify(reqObj));
  const exploreResp = await fetch(exploreUrl, {
    signal: AbortSignal.timeout(12000),
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    credentials: 'omit'
  });
  if (!exploreResp.ok) {
    throw new Error('Trends explore HTTP ' + exploreResp.status);
  }
  let exploreText = await exploreResp.text();
  // Response often prefixed with )]}'\n
  exploreText = exploreText.replace(/^\)\]\}',?\s*/, '');
  const exploreJson = JSON.parse(exploreText);
  const widgets = exploreJson?.widgets || [];
  const tsWidget = widgets.find(w => w.id === 'TIMESERIES' || w.title === 'Interest over time');
  if (!tsWidget?.token) throw new Error('No TIMESERIES token');

  const widgetReq = tsWidget.request || {
    time: timeframe,
    resolution: 'WEEK',
    locale: 'en-US',
    comparisonItem: [{ geo: geo || '', time: timeframe }],
    requestOptions: { property: '', backgroundColor: '#ffffff', category: 0 }
  };
  // Ensure keyword present on comparison items
  if (Array.isArray(widgetReq.comparisonItem)) {
    widgetReq.comparisonItem = widgetReq.comparisonItem.map((c, i) => ({
      ...c,
      complexKeywordsRestriction: c.complexKeywordsRestriction || {
        keyword: [{ type: 'BROAD', value: kw }]
      }
    }));
  }

  const dataUrl =
    'https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=0&req=' +
    encodeURIComponent(JSON.stringify(widgetReq)) +
    '&token=' + encodeURIComponent(tsWidget.token);
  const dataResp = await fetch(dataUrl, {
    signal: AbortSignal.timeout(12000),
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    credentials: 'omit'
  });
  if (!dataResp.ok) throw new Error('Trends widget HTTP ' + dataResp.status);
  let dataText = await dataResp.text();
  dataText = dataText.replace(/^\)\]\}',?\s*/, '');
  const dataJson = JSON.parse(dataText);
  const points = dataJson?.default?.timelineData || [];
  if (!points.length) return null;

  const timeline = points.map(p => {
    const v = Array.isArray(p.value) ? Number(p.value[0]) : Number(p.value);
    return {
      time: p.formattedTime || p.formattedAxisTime || p.time || '',
      value: Number.isFinite(v) ? v : 0,
      partial: !!(p.isPartial || (Array.isArray(p.hasData) && !p.hasData[0]))
    };
  }).filter(p => p.time);

  if (!timeline.length) return null;
  const values = timeline.map(t => t.value);
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const peak = Math.max(...values);
  const latest = values[values.length - 1];
  return { points: timeline, avg, peak, latest, timeframe, geo: geo || 'Worldwide' };
}

/** Free related ideas via Google Suggest (no volume). Optional gl/hl for country-local suggestions. */
async function fetchGoogleSuggest(query, gl, hl) {
  const q = String(query || '').trim();
  if (!q) return [];
  const geo = String(gl || 'us').toLowerCase();
  const lang = String(hl || 'en').toLowerCase();
  const geoQs = '&gl=' + encodeURIComponent(geo) + '&hl=' + encodeURIComponent(lang);
  const endpoints = [
    'https://suggestqueries.google.com/complete/search?client=firefox&q=' + encodeURIComponent(q) + geoQs,
    'https://suggestqueries.google.com/complete/search?client=chrome&q=' + encodeURIComponent(q) + geoQs,
    'https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=' + encodeURIComponent(q) + geoQs,
    'https://www.google.com/complete/search?client=chrome&q=' + encodeURIComponent(q) + geoQs
  ];
  const acceptLang = lang === 'en' ? 'en-US,en;q=0.9' : (lang + ',' + lang + '-' + geo.toUpperCase() + ';q=0.9,en;q=0.5');
  for (const url of endpoints) {
    try {
      const fetchOpts = {
        headers: {
          'Accept': 'application/json, text/javascript, */*;q=0.1',
          'Accept-Language': acceptLang
        }
      };
      try {
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
          fetchOpts.signal = AbortSignal.timeout(8000);
        }
      } catch (_) {}
      const resp = await fetch(url, fetchOpts);
      if (!resp.ok) continue;
      const text = (await resp.text()).trim();
      if (!text) continue;
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        // Strip JSONP callback wrappers: window.google.ac.h([...]) or similar
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start >= 0 && end > start) {
          try { json = JSON.parse(text.slice(start, end + 1)); } catch { json = null; }
        }
      }
      if (!json) continue;
      let list = [];
      if (Array.isArray(json?.[1])) list = json[1];
      else if (Array.isArray(json) && Array.isArray(json[1])) list = json[1];
      else if (Array.isArray(json) && json.length && (typeof json[0] === 'string' || Array.isArray(json[0]))) {
        list = json.map(x => Array.isArray(x) ? x[0] : x);
      }
      list = list.map(x => {
        if (typeof x === 'string') return x;
        if (Array.isArray(x)) return String(x[0] || '');
        return String(x?.suggestion || x?.query || x || '');
      }).map(s => s.trim()).filter(s => s && s.toLowerCase() !== q.toLowerCase());
      // de-dupe preserve order
      const seen = new Set();
      list = list.filter(s => {
        const k = s.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (list.length) return list.slice(0, 15);
    } catch (_) {}
  }
  return [];
}

  
  if (msg.action === 'TEXTRAZOR_ANALYZE') {
    (async () => {
      try {
        const cfg = await chrome.storage.sync.get(['textRazorApiKey']);
        const apiKey = (cfg.textRazorApiKey || '').trim();
        if (!apiKey) {
          sendResponse({ ok: false, needKey: true, error: 'Add TextRazor API key in Settings → Data API Keys' });
          cleanup();
          return;
        }
        let text = (msg.text || '').trim();
        const url = (msg.url || '').trim();
        if (!text && !url) {
          sendResponse({ ok: false, error: 'No text or URL' });
          cleanup();
          return;
        }
        if (text.length > 180000) text = text.slice(0, 180000);

        // Cache by URL (or text hash) — shared by toolbar + popup (v3 includes matchedTexts)
        const cacheKey = 'tr_v3_' + (url || text.slice(0, 80)).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 120);
        if (!msg.forceRefresh) {
          try {
            const cached = await getCachedData(cacheKey);
            if (cached && cached.ok) {
              sendResponse(cached);
              cleanup();
              return;
            }
          } catch (_) {}
        }

        const body = new URLSearchParams();
        body.set('extractors', 'entities,topics,phrases');
        body.set('classifiers', 'textrazor_iab_content_taxonomy_3.0');
        body.set('cleanup.mode', 'stripTags');
        if (text) body.set('text', text);
        else body.set('url', url);

        const resp = await fetch('https://api.textrazor.com/', {
          method: 'POST',
          headers: {
            'X-TextRazor-Key': apiKey,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept-Encoding': 'gzip'
          },
          body: body.toString(),
          signal: AbortSignal.timeout(25000)
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          sendResponse({
            ok: false,
            error: json?.error || json?.message || ('TextRazor HTTP ' + resp.status)
          });
          cleanup();
          return;
        }
        const r = json.response || json;
        // Dedupe by entityId (TextRazor often returns many mentions of the same entity).
        // Keep matchedText (surface form on page) so on-page highlight can find real words.
        const entMap = new Map();
        for (const e of (r.entities || [])) {
          if (!e.entityId) continue;
          if (e.confidenceScore != null && e.confidenceScore < 0.5) continue;
          const key = String(e.entityId).toLowerCase();
          const score = e.relevanceScore || e.confidenceScore || 0;
          const matched = (e.matchedText || '').trim();
          const prev = entMap.get(key);
          if (!prev || score > prev.score) {
            const matchedSet = new Set(prev?.matchedTexts || []);
            if (matched) matchedSet.add(matched);
            entMap.set(key, {
              id: e.entityId,
              matchedText: matched || (prev && prev.matchedText) || e.entityId,
              matchedTexts: [...matchedSet],
              type: (e.type && e.type[0]) || matched || '',
              score,
              wiki: e.wikiLink || null,
              freebase: e.freebaseId || null
            });
          } else if (matched) {
            const matchedSet = new Set(prev.matchedTexts || []);
            matchedSet.add(matched);
            prev.matchedTexts = [...matchedSet];
            if (!prev.matchedText) prev.matchedText = matched;
          }
        }
        const entities = [...entMap.values()]
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, 40);
        const topicMap = new Map();
        for (const tpc of (r.topics || [])) {
          if (!tpc.label) continue;
          if (tpc.score != null && tpc.score < 0.3) continue;
          const key = String(tpc.label).toLowerCase();
          const score = tpc.score || 0;
          const prev = topicMap.get(key);
          if (!prev || score > prev.score) {
            topicMap.set(key, { label: tpc.label, score, wiki: tpc.wikiLink || null });
          }
        }
        const topics = [...topicMap.values()]
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, 12);
        const phrases = (r.phrases || [])
          .filter(p => p.wordCount >= 2 && (p.score == null || p.score > 0))
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, 15)
          .map(p => ({ text: p.text || p.phrase || '', score: p.score || 0 }));
        const cats = (r.categories || [])
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, 5)
          .map(c => ({ label: c.label || c.categoryId || '', score: c.score || 0 }));
        const wikiLinked = entities.filter(e => e.wiki).length;
        const result = {
          ok: true,
          entities,
          topics,
          phrases,
          categories: cats,
          language: r.language || null,
          wikiLinked,
          entityCount: entities.length,
          topicCount: topics.length,
          citabilityHint: wikiLinked >= 8 ? 'Strong' : wikiLinked >= 3 ? 'Moderate' : 'Weak',
          cached: false,
          url: url || null
        };
        try { await setCachedData(cacheKey, { ...result, cached: true }, CONFIG.LONG_CACHE_TTL || CONFIG.CACHE_TTL || 3600000); } catch (_) {}
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
      cleanup();
    })();
    return true;
  }


  // ── Verify Keywords Everywhere key + remaining credits ──
  if (msg.action === 'KE_VERIFY') {
    (async () => {
      try {
        const key = String(msg.apiKey || (await getVolumeApiConfig()).keApiKey || '').trim();
        if (!key) {
          sendResponse({ ok: false, error: 'No API key' });
          cleanup();
          return;
        }
        // Cheap probe: 1 credit — returns credits remaining on the response
        const resp = await fetch('https://api.keywordseverywhere.com/v1/get_keyword_data', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Authorization': 'Bearer ' + key,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            country: 'us',
            currency: 'usd',
            dataSource: 'gkp',
            kw: ['_']
          }),
          signal: AbortSignal.timeout(15000)
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          sendResponse({
            ok: false,
            error: json?.message || json?.description || ('HTTP ' + resp.status),
            status: resp.status
          });
          cleanup();
          return;
        }
        const credits = json.credits != null ? Number(json.credits) : null;
        const used = json.credits_consumed != null ? Number(json.credits_consumed) : 1;
        sendResponse({
          ok: true,
          credits: Number.isFinite(credits) ? credits : null,
          creditsConsumed: Number.isFinite(used) ? used : 1,
          valid: true
        });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
      cleanup();
    })();
    return true;
  }

  if (msg.action === 'KW_OVERVIEW') {
    (async () => {
      const query = (msg.query || '').trim();
      if (!query) {
        sendResponse({ ok: false });
        cleanup();
        return;
      }

      // Country from SERP (gl=) or explicit msg.country — affects KE volume numbers
      const country = String(msg.country || msg.gl || 'us').toLowerCase().replace(/[^a-z]/g, '').slice(0, 5) || 'us';
      const ck = 'kw_' + country + '_' + query.toLowerCase().replace(/\s+/g, '_').slice(0, 55);

      let cfg = { keApiKey: '' };
      try { cfg = await getVolumeApiConfig(); } catch (_) {}

      // Cache: if KE key is set, only reuse cache from Keywords Everywhere.
      // Free-source cache must not block paid volume after user adds a key.
      try {
        const cached = await getCachedData(ck);
        if (cached?.ok && (cached.volume > 0 || cached.source === 'Keywords Everywhere')) {
          const src = String(cached.source || '');
          if (cfg.keApiKeyVolume) {
            if (src === 'Keywords Everywhere') {
              sendResponse(cached);
              cleanup();
              return;
            }
            // else: ignore free cache and try paid KE below
          } else {
            sendResponse(cached);
            cleanup();
            return;
          }
        }
      } catch (_) {}

      // ── PAID: Keywords Everywhere (if volume feature enabled) ─
      try {
        const volKey = cfg.keApiKeyVolume || '';
        if (volKey) {
          const ke = await fetchKeywordsEverywhereVolume(query, volKey, country);
          // Accept KE response even when volume is 0 (still has trend/cpc)
          if (ke && ke.ok) {
            await setCachedData(ck, ke, CONFIG.KW_CACHE_TTL);
            sendResponse(ke);
            cleanup();
            return;
          }
        }
      } catch (e) {
        console.warn('[KW_OVERVIEW] Keywords Everywhere volume API failed', e);
      }

      // ── FREE fallbacks (only when no KE key, or KE returned nothing) ──────────
      // SBMM first — primary free source (edu.sbmm.com.pk/api/extension/keyword)
      // Only accept positive volume (or explicit 0 with ok:true and not noData)
      try {
        const sb = await fetchSbmmKeyword(query, country);
        if (sb && sb.ok && typeof sb.volume === 'number' && sb.volume > 0) {
          await setCachedData(ck, sb, CONFIG.KW_CACHE_TTL);
          sendResponse(sb);
          cleanup();
          return;
        }
      } catch (_) {}

      try {
        const kra = await kwResearchCore(query);
        if (kra && kra.ok && kra.volume > 0) {
          await setCachedData(ck, kra, CONFIG.KW_CACHE_TTL);
          sendResponse(kra);
          cleanup();
          return;
        }
      } catch (_) {}

      // GoTrends — country-targeted first, then worldwide (Google Keyword Planner data)
      try {
        const gt = await fetchGoTrendsVolume(query, country);
        if (gt && gt.ok && typeof gt.volume === 'number' && gt.volume > 0) {
          await setCachedData(ck, gt, CONFIG.KW_CACHE_TTL);
          sendResponse(gt);
          cleanup();
          return;
        }
      } catch (_) {}

      sendResponse({ ok: false });
      cleanup();
    })();
    return true;
  }

  // ── Keyword Track (best-effort; see kwTrackCore note) ────────────
  // ── Bulk Keyword Volume (popup) — Keywords Everywhere volume + free DA + Ahrefs DR + WHOIS ──
  if (msg.action === 'BULK_KEYWORD_VOLUME') {
    (async () => {
      try {
        let keywords = Array.isArray(msg.keywords) ? msg.keywords : [];
        keywords = [...new Set(
          keywords.map(k => String(k || '').trim()).filter(k => k.length >= 1 && k.length <= 120)
        )].slice(0, 1000);
        if (!keywords.length) {
          sendResponse({ ok: false, error: 'No keywords' });
          cleanup();
          return;
        }
        const country = String(msg.country || 'us').toLowerCase();
        const cfg = await getVolumeApiConfig();
        const includeDomainMetrics = msg.includeDomainMetrics !== false;

        const looksLikeDomain = (s) => {
          const t = String(s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
          return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(t) && !/\s/.test(t);
        };
        const toDomain = (s) => String(s || '').trim().toLowerCase()
          .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

        // Volume: Keywords Everywhere (paid) → SBMM free (edu.sbmm.com.pk) per keyword
        let source = null;
        const results = [];
        const need = [];
        const hasVolumeKey = !!(cfg.keApiKeyBulk || cfg.keApiKeyVolume);

        for (const kw of keywords) {
          const ck = 'bulkvol_' + country + '_' + kw.toLowerCase().slice(0, 80);
          try {
            const cached = await getCachedData(ck);
            // Only reuse positive volumes — cached 0 was often a failed SBMM/no_data write
            if (cached && cached.keyword != null && typeof cached.volume === 'number' && cached.volume > 0) {
              results.push({ ...cached, cached: true });
              continue;
            }
          } catch (_) {}
          // Also reuse single-keyword KW_OVERVIEW cache when present
          try {
            const ck2 = 'kw_' + country + '_' + kw.toLowerCase().replace(/\s+/g, '_').slice(0, 55);
            const cached2 = await getCachedData(ck2);
            if (cached2 && cached2.ok && typeof cached2.volume === 'number' && cached2.volume > 0) {
              const row = {
                keyword: kw,
                volume: cached2.volume,
                cpc: cached2.cpc != null ? cached2.cpc : null,
                competitionIndex: cached2.competitionIndex != null ? cached2.competitionIndex : null,
                source: cached2.source || 'cache',
                cached: true
              };
              results.push(row);
              try { await setCachedData(ck, row, CONFIG.KW_CACHE_TTL); } catch (_) {}
              continue;
            }
          } catch (_) {}
          need.push(kw);
        }

        if (need.length && hasVolumeKey) {
          const fetched = await fetchKeBulkVolume(need, (cfg.keApiKeyBulk || cfg.keApiKey), country);
          source = 'Keywords Everywhere';
          const got = new Set();
          for (const row of fetched) {
            const ck = 'bulkvol_' + country + '_' + String(row.keyword || '').toLowerCase().slice(0, 80);
            const out = { ...row, source, cached: false };
            try { await setCachedData(ck, out, CONFIG.CREDIT_CACHE_TTL || CONFIG.KW_CACHE_TTL); } catch (_) {}
            results.push(out);
            got.add(String(row.keyword || '').toLowerCase());
          }
          // Rebuild need = keywords still missing volume after KE
          const have = new Set(results.map(r => String(r.keyword || '').toLowerCase()));
          need.length = 0;
          for (const kw of keywords) {
            if (!have.has(kw.toLowerCase())) need.push(kw);
          }
        } else if (need.length) {
          // no KE key — need stays as-is for SBMM below
        }

        // Free volume via SBMM (edu.sbmm.com.pk) — only accept volume > 0
        if (need.length) {
          const chunk = 3;
          let usedSbmm = false;
          const stillNeed = [];
          for (let i = 0; i < need.length; i += chunk) {
            const part = need.slice(i, i + chunk);
            await Promise.all(part.map(async (kw) => {
              if (looksLikeDomain(kw) && !/\s/.test(kw)) {
                stillNeed.push(kw);
                return;
              }
              try {
                const sb = await fetchSbmmKeyword(kw, country);
                if (sb && sb.ok && typeof sb.volume === 'number' && sb.volume > 0) {
                  usedSbmm = true;
                  const row = {
                    keyword: kw,
                    volume: sb.volume,
                    cpc: sb.cpc != null ? sb.cpc : null,
                    competitionIndex: sb.competitionIndex != null ? sb.competitionIndex : null,
                    source: 'Keyword Planner',
                    cached: false
                  };
                  const ck = 'bulkvol_' + country + '_' + kw.toLowerCase().slice(0, 80);
                  try { await setCachedData(ck, row, CONFIG.KW_CACHE_TTL); } catch (_) {}
                  results.push(row);
                  return;
                }
              } catch (_) {}
              stillNeed.push(kw);
            }));
            // small gap between chunks to avoid SBMM rate limits
            if (i + chunk < need.length) await new Promise(r => setTimeout(r, 200));
          }
          if (usedSbmm && !source) source = 'Keyword Planner';
          else if (usedSbmm && source === 'Keywords Everywhere') source = 'Keywords Everywhere + Keyword Planner';

          // Free fallback: GoTrends (Google Keyword Planner metrics) for remaining
          need.length = 0;
          stillNeed.forEach(k => need.push(k));
        }

        if (need.length) {
          const chunk = 2;
          let usedGt = false;
          for (let i = 0; i < need.length; i += chunk) {
            const part = need.slice(i, i + chunk);
            await Promise.all(part.map(async (kw) => {
              if (looksLikeDomain(kw) && !/\s/.test(kw)) {
                results.push({ keyword: kw, volume: null, cpc: null, competitionIndex: null, source: null, cached: false });
                return;
              }
              try {
                const gt = await fetchGoTrendsVolume(kw, country);
                if (gt && gt.ok && typeof gt.volume === 'number' && gt.volume > 0) {
                  usedGt = true;
                  const row = {
                    keyword: kw,
                    volume: gt.volume,
                    cpc: gt.cpc != null ? gt.cpc : null,
                    competitionIndex: gt.competitionIndex != null ? gt.competitionIndex : null,
                    source: gt.source || 'Google Keyword Planner',
                    cached: false
                  };
                  const ck = 'bulkvol_' + country + '_' + kw.toLowerCase().slice(0, 80);
                  try { await setCachedData(ck, row, CONFIG.KW_CACHE_TTL); } catch (_) {}
                  results.push(row);
                  return;
                }
              } catch (_) {}
              results.push({ keyword: kw, volume: null, cpc: null, competitionIndex: null, source: null, cached: false });
            }));
            if (i + chunk < need.length) await new Promise(r => setTimeout(r, 300));
          }
          if (usedGt && !source) source = 'Google Keyword Planner';
          else if (usedGt && source) source = source + ' + Google Keyword Planner';
        }

        if (!source && results.some(r => r.source)) {
          source = results.find(r => r.source)?.source || null;
        }

        const byKw = {};
        results.forEach(r => { byKw[String(r.keyword || '').toLowerCase()] = r; });
        // Never invent volume 0 for missing keywords — leave null so UI shows "—"
        let ordered = keywords.map(kw => byKw[kw.toLowerCase()] || {
          keyword: kw, volume: null, cpc: null, competitionIndex: null
        });

        // Domain metrics: DA (KE free), DR (Ahrefs if key), Age + Expiry (RDAP/WHOIS)
        if (includeDomainMetrics) {
          const domainLines = ordered.filter(r => looksLikeDomain(r.keyword));
          const domains = [...new Set(domainLines.map(r => rootDomain(toDomain(r.keyword))))];

          if (domains.length) {
            // DA batch — free Keywords Everywhere public metrics
            let mozMap = {};
            try {
              const batch = await mozBatchCore(domains);
              mozMap = (batch && batch.results) ? batch.results : (batch || {});
            } catch (_) {}

            // DR — Ahrefs (only if key configured); limit concurrency
            const ahrefsKey = await getAhrefsApiKey().catch(() => '');
            const drMap = {};
            if (ahrefsKey) {
              const chunk = 5;
              for (let i = 0; i < domains.length; i += chunk) {
                const part = domains.slice(i, i + chunk);
                await Promise.all(part.map(async (d) => {
                  try {
                    const dr = await ahrefsDrCore(d);
                    if (dr && (dr.domainRating != null || dr.dr != null)) {
                      drMap[d] = dr.domainRating != null ? dr.domainRating : dr.dr;
                    }
                  } catch (_) {}
                }));
              }
            }

            // Age + expiry — RDAP (concurrency limited)
            const ageMap = {};
            const ageChunk = 4;
            for (let i = 0; i < domains.length; i += ageChunk) {
              const part = domains.slice(i, i + ageChunk);
              await Promise.all(part.map(async (d) => {
                try {
                  const rd = await rdapCore(d);
                  if (rd && rd.ok) {
                    ageMap[d] = {
                      createdDate: rd.createdDate || null,
                      expirationDate: rd.expirationDate || null,
                      ageSource: rd.source || 'RDAP'
                    };
                  }
                } catch (_) {}
              }));
            }

            ordered = ordered.map(r => {
              if (!looksLikeDomain(r.keyword)) return r;
              const d = rootDomain(toDomain(r.keyword));
              const moz = mozMap[d] || mozMap[toDomain(r.keyword)] || {};
              const age = ageMap[d] || {};
              return {
                ...r,
                domain: d,
                da: moz.domainAuthority != null ? Math.round(moz.domainAuthority) : null,
                pa: moz.pageAuthority != null ? Math.round(moz.pageAuthority) : null,
                spam: moz.spamScore != null ? Math.round(moz.spamScore) : null,
                dr: drMap[d] != null ? Math.round(drMap[d]) : null,
                createdDate: age.createdDate || null,
                expirationDate: age.expirationDate || null,
                ageSource: age.ageSource || null
              };
            });
          }
        }

        sendResponse({
          ok: true,
          source: source || ordered.find(r => r.source)?.source || null,
          hasVolumeKey,
          count: ordered.length,
          cachedCount: ordered.filter(r => r.cached).length,
          rows: ordered
        });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
      cleanup();
    })();
    return true;
  }


function snapshotBatchJob() {
  if (!_batchJob) return null;
  const j = _batchJob;
  return {
    id: j.id,
    status: j.status,
    paused: !!j.paused,
    seeds: j.seeds || [],
    cursor: j.cursor || 0,
    total: j.total || 0,
    message: j.message || '',
    gl: j.gl,
    hl: j.hl,
    results: j.results || []
  };
}

async function persistDiscoverJob() {
  try {
    const snap = snapshotDiscoverJob();
    if (!snap) return;
    await chrome.storage.session.set({ rs_discover_job: snap });
    // also local so popup can read after SW death
    await chrome.storage.local.set({ rs_discover_job: snap });
  } catch (_) {}
}

function snapshotDiscoverJob() {
  if (!_discoverJob) return null;
  const j = _discoverJob;
  const keywords = Object.values(j.keywordMap || {})
    .map(r => ({
      keyword: r.keyword,
      hits: r.hits || 1,
      sources: (r.sources || []).slice(0, 5)
    }))
    .sort((a, b) => b.hits - a.hits || a.keyword.localeCompare(b.keyword));
  return {
    id: j.id,
    status: j.status,
    paused: !!j.paused,
    seed: j.seed,
    gl: j.gl || 'us',
    hl: j.hl || 'en',
    done: j.done || 0,
    total: j.total || 0,
    cursor: j.cursor || 0,
    message: j.message || '',
    count: keywords.length,
    keywords
  };
}

async function runDiscoverLoop() {
  if (!_discoverJob) { _discoverRunning = false; return; }
  const j = _discoverJob;
  const seed = j.seed;
  const concurrency = j.concurrency || 3;

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve([]), ms))
    ]);
  }

  async function runOne(q) {
    if (j.stop) return;
    try {
      const list = await withTimeout(fetchGoogleSuggest(q, j.gl, j.hl), 6000);
      for (const s of list || []) {
        const kw = String(s || '').trim();
        if (!kw || kw.length < 2) continue;
        const key = kw.toLowerCase();
        const seedToks = seed.split(/\s+/).filter(t => t.length > 1);
        const first = seedToks[0] || seed;
        const related = key.includes(seed) || seedToks.some(tok => key.includes(tok)) ||
          key.startsWith(first) || first.startsWith(key.slice(0, Math.min(key.length, first.length)));
        if (!related) continue;
        let row = j.keywordMap[key];
        if (!row) {
          row = { keyword: kw, sources: [], hits: 0 };
          j.keywordMap[key] = row;
        }
        if (row.sources.length < 8 && !row.sources.includes(q)) row.sources.push(q);
        row.hits++;
      }
    } catch (_) {}
    j.done = (j.done || 0) + 1;
    const nKw = Object.keys(j.keywordMap).length;
    j.message = 'Query ' + j.done + '/' + j.total + ' · ' + nKw + ' keywords';
  }

  try {
    while (j.cursor < j.queries.length) {
      if (j.stop) break;
      while (j.paused && !j.stop) {
        j.status = 'paused';
        j.message = 'Paused · ' + j.done + '/' + j.total + ' · ' + Object.keys(j.keywordMap).length + ' keywords';
        await new Promise(r => setTimeout(r, 350));
      }
      if (j.stop) break;
      j.status = 'running';
      const part = j.queries.slice(j.cursor, j.cursor + concurrency);
      j.cursor += part.length;
      await Promise.all(part.map(runOne));
      try { void persistDiscoverJob(); } catch (_) {}
    }
    if (j.stop) {
      j.status = 'stopped';
      j.message = 'Stopped · ' + Object.keys(j.keywordMap).length + ' keywords kept';
    } else {
      j.status = 'done';
      j.message = 'Done · ' + Object.keys(j.keywordMap).length + ' keywords';
      j.done = j.total;
      try { void persistDiscoverJob(); } catch (_) {}
    }
  } catch (e) {
    j.status = 'error';
    j.message = e.message || String(e);
  } finally {
    _discoverRunning = false;
  }
}



  // ── Discover job (pause / resume / stop) ──
  if (msg.action === 'NICHE_DISCOVER' || msg.action === 'NICHE_DISCOVER_START') {
    if (_discoverRunning && _discoverJob && (_discoverJob.status === 'running' || _discoverJob.status === 'paused')) {
      sendResponse({ ok: false, error: 'Discover already running. Pause/Stop it first.', job: snapshotDiscoverJob() });
      return true;
    }
    (async () => {
      try {
        const seed = String(msg.seed || msg.keyword || '').trim().toLowerCase();
        if (!seed || seed.length < 2) {
          sendResponse({ ok: false, error: 'Enter a seed keyword' });
          cleanup();
          return;
        }
        if (seed.length > 80) {
          sendResponse({ ok: false, error: 'Seed too long (max 80 chars)' });
          cleanup();
          return;
        }

        const useAlphabet = msg.alphabet !== false;
        const useModifiers = msg.modifiers !== false;
        const useQuestions = msg.questions !== false;
        const usePrefixAlpha = msg.prefixAlphabet === true;
        const maxQueries = Math.min(Math.max(parseInt(msg.maxQueries, 10) || 80, 10), 200);
        const concurrency = Math.min(Math.max(parseInt(msg.concurrency, 10) || 4, 1), 8);

        const queries = [];
        const seenQ = new Set();
        const pushQ = (q) => {
          const k = String(q || '').trim().toLowerCase();
          if (!k || k.length > 100 || seenQ.has(k)) return;
          seenQ.add(k);
          queries.push(k);
        };
        pushQ(seed);
        if (useAlphabet) {
          for (let i = 0; i < 26; i++) pushQ(seed + ' ' + String.fromCharCode(97 + i));
        }
        if (usePrefixAlpha) {
          for (let i = 0; i < 26; i++) pushQ(String.fromCharCode(97 + i) + ' ' + seed);
        }
        const MODS = [
          'best', 'top', 'free', 'online', 'review', 'reviews', 'vs', 'alternative',
          'for beginners', 'near me', 'price', 'cost', 'course', 'tutorial',
          'guide', 'tips', 'ideas', 'examples', 'template', 'software', 'app',
          '2024', '2025', '2026'
        ];
        if (useModifiers) {
          for (const m of MODS) {
            pushQ(seed + ' ' + m);
            pushQ(m + ' ' + seed);
          }
        }
        const QWORDS = [
          'what is', 'what are', 'how to', 'how does', 'how much', 'how many',
          'why is', 'why do', 'where to', 'when to', 'which', 'who',
          'can i', 'does', 'is', 'are'
        ];
        if (useQuestions) {
          for (const q of QWORDS) pushQ(q + ' ' + seed);
        }

        const jobQueries = queries.slice(0, maxQueries);
        const jobId = 'nd_' + Date.now();
        const jobGl = String(msg.gl || 'us').toLowerCase();
        const jobHl = String(msg.hl || 'en').toLowerCase();
        _discoverJob = {
          id: jobId,
          status: 'running',
          paused: false,
          stop: false,
          seed,
          gl: jobGl,
          hl: jobHl,
          queries: jobQueries,
          cursor: 0,
          concurrency,
          keywordMap: {}, // key -> { keyword, hits, sources[] }
          done: 0,
          total: jobQueries.length,
          message: 'Starting…'
        };
        _discoverRunning = true;

        sendResponse({ ok: true, jobId, total: jobQueries.length, status: 'running' });
        cleanup();

        // Run loop outside sendResponse
        await runDiscoverLoop();
      } catch (e) {
        try {
          sendResponse({ ok: false, error: e.message || String(e) });
        } catch (_) {}
        if (_discoverJob) {
          _discoverJob.status = 'error';
          _discoverJob.message = e.message || String(e);
        }
        _discoverRunning = false;
        cleanup();
      }
    })();
    return true;
  }

  if (msg.action === 'NICHE_DISCOVER_STATUS') {
    (async () => {
      try {
        if (!_discoverJob) {
          const s = await chrome.storage.session.get('rs_discover_job').catch(() => ({}));
          let snap = s && s.rs_discover_job;
          if (!snap) {
            const l = await chrome.storage.local.get('rs_discover_job').catch(() => ({}));
            snap = l && l.rs_discover_job;
          }
          if (snap && (snap.status === 'running' || snap.status === 'paused')) {
            // SW restarted mid-job — cannot resume queries, mark stopped with partial keywords
            snap.status = 'stopped';
            snap.message = (snap.message || 'Stopped') + ' (session restored)';
            sendResponse({ ok: true, job: snap, running: false, restored: true });
            return;
          }
          if (snap) {
            sendResponse({ ok: true, job: snap, running: false, restored: true });
            return;
          }
        }
        sendResponse({ ok: true, job: snapshotDiscoverJob(), running: _discoverRunning });
      } catch (e) {
        sendResponse({ ok: true, job: snapshotDiscoverJob(), running: _discoverRunning });
      }
    })();
    return true;
  }

  if (msg.action === 'NICHE_DISCOVER_PAUSE') {
    if (_discoverJob && !_discoverJob.stop) {
      _discoverJob.paused = true;
      _discoverJob.status = 'paused';
      _discoverJob.message = 'Paused — press Resume to continue';
    }
    sendResponse({ ok: true, job: snapshotDiscoverJob() });
    return true;
  }

  if (msg.action === 'NICHE_DISCOVER_RESUME') {
    if (_discoverJob && (_discoverJob.status === 'paused' || _discoverJob.paused)) {
      _discoverJob.paused = false;
      _discoverJob.status = 'running';
      _discoverJob.message = 'Resuming…';
      if (!_discoverRunning) {
        _discoverRunning = true;
        runDiscoverLoop().catch(() => { _discoverRunning = false; });
      }
    }
    sendResponse({ ok: true, job: snapshotDiscoverJob() });
    return true;
  }

  if (msg.action === 'NICHE_DISCOVER_STOP') {
    if (_discoverJob) {
      _discoverJob.stop = true;
      _discoverJob.paused = false;
      _discoverJob.status = 'stopped';
      _discoverJob.message = 'Stopped';
    }
    _discoverRunning = false;
    sendResponse({ ok: true, job: snapshotDiscoverJob() });
    return true;
  }



  // ── Discover batch competition check (survives popup close) ──
  if (msg.action === 'NICHE_BATCH_START') {
    if (_batchRunning || _nicheJobRunning) {
      sendResponse({ ok: false, error: 'Another niche job is already running' });
      return true;
    }
    const seeds = Array.isArray(msg.seeds) ? msg.seeds.map(s => String(s || '').trim()).filter(Boolean) : [];
    if (!seeds.length) {
      sendResponse({ ok: false, error: 'No keywords selected' });
      return true;
    }
    const capped = seeds.slice(0, 10);
    const gl = msg.gl || 'us';
    const hl = msg.hl || 'en';
    const near = msg.near || '';
    const jobId = 'nb_' + Date.now();
    _batchJob = {
      id: jobId,
      status: 'running',
      paused: false,
      stop: false,
      seeds: capped,
      cursor: 0,
      gl, hl, near,
      results: [],
      message: 'Starting batch…',
      total: capped.length
    };
    _batchRunning = true;
    sendResponse({ ok: true, jobId, total: capped.length });
    (async () => {
      try {
        for (let i = 0; i < capped.length; i++) {
          if (_batchJob.stop) break;
          while (_batchJob.paused && !_batchJob.stop) {
            _batchJob.status = 'paused';
            _batchJob.message = 'Paused · ' + i + '/' + capped.length;
            try {
              await chrome.storage.local.set({ rs_batch_job: snapshotBatchJob() });
            } catch (_) {}
            await new Promise(r => setTimeout(r, 400));
          }
          if (_batchJob.stop) break;
          _batchJob.status = 'running';
          _batchJob.cursor = i;
          const seed = capped[i];
          _batchJob.message = (i + 1) + '/' + capped.length + ' · ' + seed + ' · Fetching Top 10…';
          try {
            await chrome.storage.local.set({ rs_batch_job: snapshotBatchJob() });
          } catch (_) {}

          // Run single niche into a temp job id then read result
          const singleId = jobId + '_' + i;
          _nicheJobAbort = false;
          _nicheJobRunning = true;
          try {
            await nicheRunSingle(seed, gl, hl, near, singleId);
          } catch (e) {
            _batchJob.results.push({ seed, ok: false, error: e.message || String(e) });
            _nicheJobRunning = false;
            continue;
          }
          _nicheJobRunning = false;
          const job = await nicheJobGet();
          if (job && job.status === 'done' && job.result) {
            const v = job.result.verdict || {};
            const vol = job.result.volume;
            _batchJob.results.push({
              seed,
              ok: true,
              score: v.scoreNum != null ? v.scoreNum : (v.score != null ? v.score : null),
              verdict: v.verdict || '',
              label: v.verdictLabel || v.label || v.verdict || '',
              weakCount: v.lowAuth != null ? v.lowAuth : null,
              volume: (typeof vol === 'number') ? vol : null,
              volumeConfirmed: !!job.result.volumeConfirmed,
              volumeSource: job.result.volumeSource || null,
              payload: job.result
            });
          } else {
            _batchJob.results.push({
              seed,
              ok: false,
              error: (job && (job.error || job.message)) || 'Failed'
            });
          }
        }
        if (_batchJob.stop) {
          _batchJob.status = 'stopped';
          _batchJob.message = 'Stopped · ' + _batchJob.results.length + ' checked';
        } else {
          _batchJob.status = 'done';
          _batchJob.message = 'Batch done · ' + _batchJob.results.filter(r => r.ok).length + '/' + _batchJob.results.length + ' checked';
        }
      } catch (e) {
        _batchJob.status = 'error';
        _batchJob.message = e.message || String(e);
      } finally {
        _batchRunning = false;
        _nicheJobRunning = false;
        try {
          await chrome.storage.local.set({ rs_batch_job: snapshotBatchJob() });
        } catch (_) {}
      }
    })();
    return true;
  }

  if (msg.action === 'NICHE_BATCH_STATUS') {
    (async () => {
      let job = snapshotBatchJob();
      if (!job) {
        try {
          const s = await chrome.storage.local.get('rs_batch_job');
          job = s && s.rs_batch_job;
        } catch (_) {}
      }
      sendResponse({ ok: true, job, running: _batchRunning });
    })();
    return true;
  }

  if (msg.action === 'NICHE_BATCH_PAUSE') {
    if (_batchJob) {
      _batchJob.paused = true;
      _batchJob.status = 'paused';
      _batchJob.message = 'Paused';
    }
    sendResponse({ ok: true, job: snapshotBatchJob() });
    return true;
  }

  if (msg.action === 'NICHE_BATCH_RESUME') {
    if (_batchJob) {
      _batchJob.paused = false;
      _batchJob.status = 'running';
      _batchJob.message = 'Resuming…';
    }
    sendResponse({ ok: true, job: snapshotBatchJob() });
    return true;
  }

  if (msg.action === 'NICHE_BATCH_STOP') {
    if (_batchJob) {
      _batchJob.stop = true;
      _batchJob.paused = false;
      _batchJob.status = 'stopped';
    }
    _nicheJobAbort = true;
    sendResponse({ ok: true, job: snapshotBatchJob() });
    return true;
  }

  if (msg.action === 'KW_TRACK') {
    kwTrackCore(msg.query)
      .then(r => sendResponse(r || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  // ── SERP Deep Check ─────────────────────────────────────────────
  if (msg.action === 'RANK_DEEP_CHECK') {
    handleRankDeepCheck(msg, sendResponse, cleanup);
    return true;
  }

  // ── SERP Fetch Page ─────────────────────────────────────────────
  // ── Real server timing + compression (replaces size-based estimate) ──
  if (msg.action === 'SERVER_TIMING') {
    (async () => {
      const url = msg.url;
      if (!url) { sendResponse({ ok: false }); cleanup(); return; }
      try {
        const t0 = performance.now();
        const resp = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          redirect: 'follow',
          signal: AbortSignal.timeout(12000)
        });
        // Time to first byte-ish: time until headers + start of body resolve
        const ttfb = Math.round(performance.now() - t0);
        const enc = (resp.headers.get('content-encoding') || '').toLowerCase();
        const compression = enc ? enc : (resp.headers.get('vary') || '').toLowerCase().includes('accept-encoding') ? 'maybe' : '';
        sendResponse({
          ok: true,
          status: resp.status,
          statusText: resp.statusText || '',
          responseTime: ttfb,
          compression: enc || null
        });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      cleanup();
    })();
    return true;
  }


  if (msg.action === 'SITE_INDEXATION') {
    handleSiteIndexation(msg, sendResponse, cleanup);
    return true;
  }

  if (msg.action === 'SERP_FETCH_PAGE') {
    handleSERPFetchPage(msg, sendResponse, cleanup);
    return true;
  }

  // ── Rank Tracker: paid SERP API check (Serper.dev / SerpApi) ────────
  if (msg.action === 'RANK_API_CHECK') {
    handleRankApiCheck(msg, sendResponse, cleanup);
    return true;
  }

  // ── Geocode a place name → lat/lng (OpenStreetMap Nominatim, free) ──
  if (msg.action === 'GEOCODE') {
    handleGeocode(msg, sendResponse, cleanup);
    return true;
  }

  // ── Local pack (map pack) check at a lat/lng point ──
  if (msg.action === 'LOCAL_PACK_CHECK') {
    handleLocalPackCheck(msg, sendResponse, cleanup);
    return true;
  }

  // ── Competitor analysis (open in background tab, run same pipeline) ──
  if (msg.action === 'COMPETITOR_ANALYZE') {
    handleCompetitorAnalyze(msg, sendResponse, cleanup);
    return true;
  }

  // ── Backlink (co-citation) Discovery — free, no API key ──────────
  // Scrapes Google for pages that MENTION a domain but are not ON it.
  // These are mention/co-citation candidates, not verified backlinks.
  if (msg.action === 'BACKLINK_FETCH') {
    (async () => {
      const domain = (msg.domain || '').replace(/^www\./, '').toLowerCase();
      if (!domain) { sendResponse({ ok: false, error: 'No domain' }); cleanup(); return; }

      const ck = 'rp_backlinks_' + domain;
      try {
        const cached = await getCachedData(ck);
        if (cached && Array.isArray(cached.backlinks)) { sendResponse(cached); cleanup(); return; }
      } catch (_) {}

      const googleDomain = msg.googleDomain && /^www\.google\./.test(msg.googleDomain)
        ? msg.googleDomain : 'www.google.com';
      const q = `"${domain}" -site:${domain}`;
      const url = `https://${googleDomain}/search?q=${encodeURIComponent(q)}&num=20`;

      try {
        const resp = await fetch(url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
          },
          signal: AbortSignal.timeout(12000)
        });
        if (!resp.ok) { sendResponse({ ok: false, error: 'HTTP ' + resp.status }); cleanup(); return; }
        const html = await resp.text();
        const backlinks = extractBacklinkDomains(html, domain);
        const result = { ok: true, domain, backlinks, query: q, disclaimer: 'Web mentions / co-citation candidates from Google — not verified backlinks.' };
        await setCachedData(ck, result, CONFIG.LONG_CACHE_TTL);
        sendResponse(result);
      } catch (e) {
        console.warn('[RP] Backlink fetch failed:', e.message);
        sendResponse({ ok: false, error: e.message });
      }
      cleanup();
    })();
    return true;
  }

  // ── AI SERP Analysis ─────────────────────────────────────────────
  if (msg.action === 'AI_SERP_ANALYZE') {
    handleAISERPAnalyze(msg, sendResponse, cleanup);
    return true;
  }

  // ── Google Trends: related (Suggest) + interest over time (unofficial) ──
  if (msg.action === 'TRENDS_SUGGEST') {
    (async () => {
      try {
        const q = String(msg.query || msg.keyword || '').trim();
        if (!q) {
          sendResponse({ ok: false, error: 'No query' });
          cleanup();
          return;
        }
        const geo = String(msg.geo || '').trim(); // e.g. 'US', 'PK', '' = worldwide
        const timeframe = String(msg.timeframe || 'today 12-m');
        const related = await fetchGoogleSuggest(q);
        let timeline = null;
        let timelineError = null;
        try {
          timeline = await fetchGoogleTrendsInterest(q, geo, timeframe);
        } catch (e) {
          timelineError = e.message || String(e);
        }
        const result = {
          ok: true,
          query: q,
          related: related || [],
          timeline: timeline || null,
          timelineError: timeline ? null : timelineError,
          trendsUrl: 'https://trends.google.com/trends/explore?q=' + encodeURIComponent(q) +
            (geo ? '&geo=' + encodeURIComponent(geo) : '') +
            '&date=' + encodeURIComponent(timeframe)
        };
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
      cleanup();
    })();
    return true;
  }

  // ── Open Tab ──────────────────────────────────────────────────────
  if (msg.action === 'OPEN_TAB') {
    chrome.tabs.create({ url: msg.url, active: true });
    sendResponse({ ok: true });
    cleanup();
    return true;
  }

  // ── Automation State ───────────────────────────────────────────
  if (msg.action === 'AUTOMATION_GET_STATE' || msg.action === 'AUTOMATION_UPDATE_STATE' || msg.action === 'AUTOMATION_CLEAR_STATE') {
    handleAutomationState(msg, sendResponse, cleanup);
    return true;
  }

  return false;
});

// ─── Helper Functions ─────────────────────────────────────────────

// Extract external referring domains from Google SERP HTML (no DOMParser in SW)
function extractBacklinkDomains(html, targetDomain, max = 10) {
  const out = [];
  const seen = new Set();
  const target = targetDomain.toLowerCase();

  // Google wraps result URLs either directly or as /url?q=<encoded>
  const hrefRe = /href="(\/url\?q=|https?:\/\/)([^"&]+)/gi;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    let raw = m[1] === '/url?q=' ? decodeURIComponent(m[2]) : (m[1] + m[2]);
    if (!/^https?:\/\//i.test(raw)) continue;

    let host;
    try { host = new URL(raw).hostname.replace(/^www\./, '').toLowerCase(); }
    catch (_) { continue; }

    if (!host || seen.has(host)) continue;
    if (host.includes('google') || host.includes('gstatic') || host.includes('googleusercontent')) continue;
    if (host === target || host.endsWith('.' + target)) continue;
    if (/youtube\.com|webcache|translate\.google/.test(host)) continue;
    if (/facebook\.com\/sharer|twitter\.com\/intent|x\.com\/intent/.test(raw)) continue;

    seen.add(host);
    out.push({ domain: host, url: raw });
    if (out.length >= max) break;
  }
  return out;
}


function detectCdnFromNameservers(nameservers) {
  const ns = nameservers.join(' ').toLowerCase();
  if (ns.includes('cloudflare')) return 'Cloudflare';
  if (ns.includes('awsdns')) return 'AWS Route 53';
  if (ns.includes('google') || ns.includes('googledomains')) return 'Google Cloud DNS';
  if (ns.includes('azure') || ns.includes('microsoft')) return 'Azure DNS';
  if (ns.includes('vercel') || ns.includes('zeit')) return 'Vercel';
  if (ns.includes('netlify')) return 'Netlify';
  if (ns.includes('namecheap') || ns.includes('registrar-servers')) return 'Namecheap';
  if (ns.includes('godaddy') || ns.includes('domaincontrol')) return 'GoDaddy';
  if (ns.includes('hostinger')) return 'Hostinger';
  return null;
}

function extractRdapRegistrar(data) {
  if (!data.entities) return null;
  for (const e of data.entities) {
    if (e.roles?.includes('registrar')) {
      if (e.vcardArray?.[1]) for (const f of e.vcardArray[1]) if (f[0] === 'fn') return f[3];
      if (e.handle) return e.handle;
    }
  }
  return null;
}

function extractRdapEvents(data) {
  const ev = {};
  for (const e of (data.events || [])) {
    const action = String(e.eventAction || '').toLowerCase().trim();
    if (!e.eventDate) continue;
    if (!ev.registration && isRegistrationAction(action)) ev.registration = e.eventDate;
    if (!ev.expiration && isExpirationAction(action)) ev.expiration = e.eventDate;
    if (action === 'last changed' || action === 'last update of rdap database') {
      ev.updated = ev.updated || e.eventDate;
    }
  }
  return ev;
}

function isRegistrationAction(action) {
  if (action === 'registration' || action === 'registered' || action === 'created') return true;
  return action.includes('registration') &&
    !action.includes('expiration') &&
    !action.includes('expire') &&
    !action.includes('update') &&
    !action.includes('transfer');
}

function isExpirationAction(action) {
  return action === 'expiration' || action.includes('expir');
}

// ─── Firecrawl Handlers (Keyless + Auth) ───────────────────────────
// Prefer v2 (official keyless path). Treat placeholder/partial keys as empty.
function normalizeFirecrawlKey(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const k = raw.trim();
  // Ignore placeholders, masked values, and obviously incomplete keys
  if (!k || k === 'fc-…' || k === 'fc-...' || k === 'fc-' || k.length < 12) return null;
  if (!k.startsWith('fc-') && !k.startsWith('fc_')) return null;
  return k;
}

async function getFirecrawlKey() {
  try {
    const result = await chrome.storage.sync.get('firecrawlConfig');
    const cfg = result.firecrawlConfig ? JSON.parse(result.firecrawlConfig) : null;
    return normalizeFirecrawlKey(cfg?.apiKey);
  } catch (_) { return null; }
}

function firecrawlHeaders(apiKey) {
  const h = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    // Soft client marker — helps keyless routing on some networks
    'X-Firecrawl-Client': 'rankseo-extension',
    'X-Integration': 'rankseo'
  };
  if (apiKey) h['Authorization'] = 'Bearer ' + apiKey;
  return h;
}

async function firecrawlScrapeRequest(url, apiKey, formats) {
  const body = {
    url,
    formats: formats || ['markdown'],
    onlyMainContent: true,
    timeout: 30000
  };
  const headers = firecrawlHeaders(apiKey);

  // v2 first (keyless-native), then v1 fallback
  for (const base of ['https://api.firecrawl.dev/v2', 'https://api.firecrawl.dev/v1']) {
    try {
      const resp = await fetch(base + '/scrape', {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        return { ok: true, data, version: base.includes('/v2') ? 'v2' : 'v1' };
      }
      // Auth/rate errors — try next version or surface
      if (resp.status === 401 || resp.status === 403 || resp.status === 402 || resp.status === 429) {
        if (base.includes('/v2')) continue; // try v1
        return {
          ok: false,
          status: resp.status,
          error: data.error || data.message || ('Status ' + resp.status),
          code: data.code
        };
      }
      // Other errors — don't bother with v1 if payload was rejected
      return {
        ok: false,
        status: resp.status,
        error: data.error || data.message || ('Status ' + resp.status)
      };
    } catch (e) {
      if (base.includes('/v2')) continue;
      return { ok: false, error: e.message || 'Network error' };
    }
  }
  return { ok: false, error: 'Firecrawl unreachable' };
}

function handleFirecrawl(msg, sendResponse, cleanup) {
  const action = msg.action;

  (async () => {
    if (action === 'FIRECRAWL_TEST') {
      const apiKey = normalizeFirecrawlKey(msg.apiKey) || await getFirecrawlKey();
      try {
        // Prefer free search probe (no registration) — matches public keyless API
        let searchOk = false;
        let searchErr = '';
        try {
          const sResp = await fetch('https://api.firecrawl.dev/v2/search', {
            method: 'POST',
            headers: firecrawlHeaders(apiKey),
            body: JSON.stringify({ query: 'rankseo test', limit: 1 })
          });
          const sData = await sResp.json().catch(() => ({}));
          if (sResp.ok && (sData.success !== false)) {
            searchOk = true;
            sendResponse({
              ok: true,
              keyless: !apiKey,
              mode: apiKey ? 'authenticated' : 'keyless_free_search',
              version: 'v2',
              feature: 'search',
              results: (sData.data && sData.data.web) ? sData.data.web.length : 0
            });
            cleanup();
            return;
          }
          searchErr = sData.error || sData.message || ('Search status ' + sResp.status);
        } catch (e) {
          searchErr = e.message || 'search network error';
        }

        // Fallback: scrape test
        const result = await firecrawlScrapeRequest('https://example.com', apiKey, ['markdown']);
        if (result.ok) {
          sendResponse({
            ok: true,
            keyless: !apiKey,
            mode: apiKey ? 'authenticated' : 'keyless',
            version: result.version,
            feature: 'scrape',
            note: searchOk ? '' : ('Search probe: ' + searchErr)
          });
        } else {
          let err = result.error || ('Status ' + result.status);
          if (!apiKey && (result.status === 403 || result.status === 401)) {
            err = 'Keyless scrape blocked (Status ' + result.status + '). Free /v2/search may still work. ' +
              (searchErr ? ('Search: ' + searchErr + '. ') : '') +
              'Optional: add fc- API key, or use TinyFish (Monid).';
          } else if (apiKey && (result.status === 401 || result.status === 403)) {
            err = 'Invalid or restricted Firecrawl key (Status ' + result.status + ').';
          }
          sendResponse({ ok: false, error: err, status: result.status, keyless: !apiKey, searchError: searchErr });
        }
        cleanup();
        return;
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
        cleanup();
        return;
      }
    }

    // Key is optional — keyless free tier works without it (when network allows)
    const apiKey = normalizeFirecrawlKey(msg.apiKey) || await getFirecrawlKey();

    if (action === 'FIRECRAWL_SCRAPE') {
      const ck = 'fc_scrape_' + btoa(unescape(encodeURIComponent(msg.url || ''))).slice(0, 40);
      try {
        const cached = await getCachedData(ck);
        if (cached?.ok) {
          sendResponse(cached);
          cleanup();
          return;
        }
      } catch (_) {}

      try {
        const result = await firecrawlScrapeRequest(msg.url, apiKey, msg.formats || ['markdown']);

        if (!result.ok) {
          // Auto-fallback: TinyFish free fetch via Monid (no Firecrawl needed)
          try {
            const monidKey = await getMonidKey();
            const tfHeaders = {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + monidKey
            };
            let tfResp = await fetch('https://api.monid.ai/v1/run', {
              method: 'POST',
              headers: tfHeaders,
              body: JSON.stringify({
                provider: 'tinyfish',
                endpoint: '/fetch',
                input: { urls: [msg.url], format: 'markdown' }
              })
            });
            let tfData = await tfResp.json().catch(() => ({}));
            if (tfResp.status === 202 && (tfData.runId || tfData.id)) {
              const runId = tfData.runId || tfData.id;
              const start = Date.now();
              let delay = 1200;
              while (Date.now() - start < 45000) {
                await new Promise(r => setTimeout(r, delay));
                tfResp = await fetch('https://api.monid.ai/v1/runs/' + runId, { headers: tfHeaders });
                tfData = await tfResp.json().catch(() => ({}));
                const st = (tfData.status || '').toUpperCase();
                if (['COMPLETED', 'FAILED', 'BLOCKED', 'STOPPED', 'TIMED_OUT'].includes(st)) break;
                delay = Math.min(delay * 1.4, 4000);
              }
            }
            const out = tfData.output || tfData.result || tfData;
            const page = (out?.results || [])[0];
            if (page && (page.text || page.markdown)) {
              const md = (page.text || page.markdown || '').slice(0, 12000);
              const fallbackResult = {
                ok: true,
                markdown: md,
                wordCount: md.split(/\s+/).filter(Boolean).length,
                title: page.title || '',
                description: page.description || '',
                keyless: true,
                source: 'tinyfish_fallback',
                note: 'Firecrawl unavailable — used free TinyFish fetch',
                ts: Date.now()
              };
              await setCachedData(ck, fallbackResult, 5 * 60 * 1000);
              sendResponse(fallbackResult);
              cleanup();
              return;
            }
          } catch (_) { /* fall through to error */ }

          sendResponse({
            ok: false,
            error: result.error || 'Firecrawl request failed',
            status: result.status,
            keyless: !apiKey
          });
          cleanup();
          return;
        }

        const data = result.data;
        const md = data.data?.markdown || data.markdown || '';
        const payload = {
          ok: true,
          markdown: md.slice(0, 12000),
          wordCount: md.split(/\s+/).filter(Boolean).length,
          title: data.data?.metadata?.title || data.metadata?.title || '',
          description: data.data?.metadata?.description || data.metadata?.description || '',
          keyless: !apiKey,
          source: apiKey ? 'firecrawl_auth' : 'firecrawl_keyless',
          version: result.version,
          ts: Date.now()
        };

        await setCachedData(ck, payload, 5 * 60 * 1000);
        sendResponse(payload);
        cleanup();
        return;

      } catch (e) {
        sendResponse({ ok: false, error: e.message || 'Network error' });
        cleanup();
        return;
      }
    }

    if (action === 'FIRECRAWL_SEARCH') {
      try {
        const query = String(msg.query || '').trim();
        const limit = Math.min(Math.max(parseInt(msg.limit, 10) || 5, 1), 20);
        if (!query) {
          sendResponse({ ok: false, error: 'Empty query' });
          cleanup();
          return;
        }

        // Free keyless path (no registration): POST /v2/search with only query + limit
        // https://api.firecrawl.dev/v2/search
        const headers = firecrawlHeaders(apiKey); // Authorization only if user key exists
        const simpleBody = { query, limit };

        let resp = await fetch('https://api.firecrawl.dev/v2/search', {
          method: 'POST',
          headers,
          body: JSON.stringify(simpleBody)
        });
        let data = await resp.json().catch(() => ({}));

        // If user has a key and wants scrape snippets, optionally retry with scrapeOptions
        if (resp.ok && apiKey && msg.scrape === true) {
          try {
            const rich = await fetch('https://api.firecrawl.dev/v2/search', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                query,
                limit,
                scrapeOptions: { formats: ['markdown'], onlyMainContent: true }
              })
            });
            if (rich.ok) {
              data = await rich.json().catch(() => data);
              resp = rich;
            }
          } catch (_) { /* keep simple results */ }
        }

        // v1 fallback only if v2 hard-fails
        if (!resp.ok && (resp.status === 404 || resp.status === 405)) {
          resp = await fetch('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers,
            body: JSON.stringify(simpleBody)
          });
          data = await resp.json().catch(() => ({}));
        }

        if (!resp.ok) {
          sendResponse({
            ok: false,
            error: data.error || data.message || ('Search failed (' + resp.status + ')'),
            status: resp.status,
            keyless: !apiKey
          });
          cleanup();
          return;
        }

        // Normalize: free API returns { success, data: { web: [...] } }
        const root = data.data || data;
        const web = Array.isArray(root.web)
          ? root.web
          : (Array.isArray(root) ? root : (root.results || root.organic || []));
        const results = (web || []).map((r, i) => ({
          position: r.position || i + 1,
          title: r.title || '',
          url: r.url || r.link || '',
          description: r.description || r.snippet || r.markdown || '',
          markdown: r.markdown || ''
        }));

        sendResponse({
          ok: true,
          results,
          data: root,
          keyless: !apiKey,
          source: apiKey ? 'firecrawl_auth' : 'firecrawl_free',
          creditsUsed: data.creditsUsed,
          id: data.id
        });
        cleanup();
        return;
      } catch (e) {
        sendResponse({ ok: false, error: e.message || 'Network error' });
        cleanup();
        return;
      }
    }

    if (action === 'FIRECRAWL_EXTRACT') {
      try {
        // extract usually needs a key; still try
        const resp = await fetch('https://api.firecrawl.dev/v1/extract', {
          method: 'POST',
          headers: firecrawlHeaders(apiKey),
          body: JSON.stringify({
            urls: [msg.url],
            prompt: msg.prompt || 'Extract main content, headings, key topics.',
            timeout: 30000
          })
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          sendResponse({ ok: false, error: err.error || 'Firecrawl extract failed (often requires API key)' });
          cleanup();
          return;
        }

        const data = await resp.json();
        sendResponse({ ok: true, data: data.data || data, keyless: !apiKey });
        cleanup();
        return;

      } catch (e) {
        sendResponse({ ok: false, error: e.message || 'Network error' });
        cleanup();
        return;
      }
    }

    sendResponse({ ok: false, error: 'Unknown Firecrawl action' });
    cleanup();
  })();
}

// ─── Monid Handlers ───────────────────────────────────────────────
async function getMonidKey() {
  try {
    const result = await chrome.storage.sync.get(['monidConfig', 'monidApiKey']);
    if (result.monidConfig) {
      const cfg = typeof result.monidConfig === 'string' ? JSON.parse(result.monidConfig) : result.monidConfig;
      if (cfg?.apiKey) return cfg.apiKey;
    }
    if (result.monidApiKey) return result.monidApiKey;
  } catch (_) {}
  // Default key supplied for ShahzaibSEO (user can override in Settings)
  return 'monid_live_zoTUYEfdAH8GgpQT4abowDtk';
}

function handleMonid(msg, sendResponse, cleanup) {
  (async () => {
    const apiKey = msg.apiKey || await getMonidKey();
    const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
    const base = 'https://api.monid.ai/v1';

    try {
      if (msg.action === 'MONID_DISCOVER') {
        const resp = await fetch(base + '/discover', {
          method: 'POST', headers,
          body: JSON.stringify({ query: msg.query, limit: msg.limit || 8 })
        });
        const data = await resp.json().catch(() => ({}));
        sendResponse(resp.ok ? { ok: true, data } : { ok: false, error: data.message || data.error || 'Discover failed' });
        cleanup();
        return;
      }

      if (msg.action === 'MONID_RUN') {
        const body = { provider: msg.provider, endpoint: msg.endpoint };
        // Monid HTTP API: input → body, queryParams, pathParams
        // TinyFish /search is GET-style (queryParams); /fetch is POST body (input)
        if (msg.input) body.input = msg.input;
        if (msg.queryParams) body.queryParams = msg.queryParams;
        else if (msg.query) body.queryParams = msg.query; // legacy alias from popup
        if (msg.pathParams) body.pathParams = msg.pathParams;
        else if (msg.path) body.pathParams = msg.path;

        // Guard: tinyfish /search must have queryParams.query
        if (body.provider === 'tinyfish' && body.endpoint === '/search') {
          const q = body.queryParams?.query || body.input?.query;
          if (!q) {
            sendResponse({ ok: false, error: 'TinyFish /search requires a query string' });
            cleanup();
            return;
          }
          if (!body.queryParams) body.queryParams = { query: q };
          delete body.input; // search uses queryParams only
        }

        let resp = await fetch(base + '/run', { method: 'POST', headers, body: JSON.stringify(body) });
        let data = await resp.json().catch(() => ({}));

        if (resp.status === 202 && (data.runId || data.id)) {
          const runId = data.runId || data.id;
          const maxWait = msg.waitMs || 45000;
          const start = Date.now();
          let delay = 1500;
          while (Date.now() - start < maxWait) {
            await new Promise(r => setTimeout(r, delay));
            resp = await fetch(base + '/runs/' + runId, { headers });
            data = await resp.json().catch(() => ({}));
            const st = (data.status || '').toUpperCase();
            if (['COMPLETED', 'FAILED', 'BLOCKED', 'STOPPED', 'TIMED_OUT'].includes(st)) break;
            delay = Math.min(delay * 1.4, 5000);
          }
          const stFinal = (data.status || '').toUpperCase();
          sendResponse({
            ok: stFinal === 'COMPLETED',
            status: data.status,
            runId,
            data,
            output: data.output || data.result || data.providerResponse?.body || data,
            cost: data.cost,
            error: stFinal !== 'COMPLETED' ? (data.error || data.message || data.reason || stFinal) : undefined
          });
          cleanup();
          return;
        }

        // Sync COMPLETED (200) or immediate error
        if (resp.ok || resp.status === 200 || (data.status || '').toUpperCase() === 'COMPLETED') {
          sendResponse({
            ok: true,
            status: data.status || 'COMPLETED',
            data,
            output: data.output || data.result || data
          });
        } else {
          const errMsg = data.message || data.error || data.reason || data.status || ('Run failed: HTTP ' + resp.status);
          sendResponse({ ok: false, error: errMsg, status: resp.status, data });
        }
        cleanup();
        return;
      }

      if (msg.action === 'MONID_DOMAIN_RATING') {
        const today = new Date().toISOString().slice(0, 10);
        const body = {
          provider: 'ahrefs',
          endpoint: '/site-explorer/domain-rating',
          queryParams: { target: msg.target || msg.domain, date: today }
        };
        // Reuse run logic via self-message style
        let resp = await fetch(base + '/run', { method: 'POST', headers, body: JSON.stringify(body) });
        let data = await resp.json().catch(() => ({}));
        if (resp.status === 202 && (data.runId || data.id)) {
          const runId = data.runId || data.id;
          const start = Date.now();
          let delay = 1200;
          while (Date.now() - start < 20000) {
            await new Promise(r => setTimeout(r, delay));
            resp = await fetch(base + '/runs/' + runId, { headers });
            data = await resp.json().catch(() => ({}));
            if (['COMPLETED', 'FAILED', 'BLOCKED', 'STOPPED', 'TIMED_OUT'].includes((data.status || '').toUpperCase())) break;
            delay = Math.min(delay * 1.3, 4000);
          }
        }
        sendResponse({
          ok: (data.status || '').toUpperCase() === 'COMPLETED' || resp.status === 200,
          data,
          output: data.output || data.result || data
        });
        cleanup();
        return;
      }

      if (msg.action === 'MONID_TEST') {
        const resp = await fetch(base + '/auth/whoami', { headers });
        const data = await resp.json().catch(() => ({}));
        sendResponse(resp.ok ? { ok: true, data } : { ok: false, error: data.message || 'Auth failed' });
        cleanup();
        return;
      }

      sendResponse({ ok: false, error: 'Unknown Monid action' });
      cleanup();
    } catch (e) {
      sendResponse({ ok: false, error: e.message || 'Network error' });
      cleanup();
    }
  })();
}

// ─── Rank Deep Check ──────────────────────────────────────────────
function handleRankDeepCheck(msg, sendResponse, cleanup) {
  const { query, domain, maxPages = 10, startPage = 0 } = msg;
  const exportMode = domain === '__EXPORT_ALL__';
  const pages = Math.min(maxPages || 10, 10);

  (async () => {
    const results = [];
    let foundPosition = -1;
    let foundDomain = '';
    let foundTitle = '';

    for (let page = startPage; page < startPage + pages; page++) {
      if (!exportMode && foundPosition >= 0) break;

      const start = page * 10;
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&start=${start}&num=10&hl=en`;

      try {
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9'
          }
        });

        if (!resp.ok) {
          sendResponse({ ok: false, error: `HTTP ${resp.status} on page ${page + 1}` });
          cleanup();
          return;
        }

        const html = await resp.text();
        const hrefRegex = /href="\/url\?q=(https?:\/\/[^"&]+)/g;
        let hrefMatch;
        const pageResults = [];

        while ((hrefMatch = hrefRegex.exec(html)) !== null) {
          try {
            const rawUrl = decodeURIComponent(hrefMatch[1]);
            const parsedDomain = new URL(rawUrl).hostname.replace(/^www\./, '');
            if (!parsedDomain || parsedDomain.includes('google') || parsedDomain.includes('gstatic')) continue;
            if (pageResults.find(r => r.domain === parsedDomain)) continue;
            pageResults.push({ domain: parsedDomain, url: rawUrl, title: '' });
          } catch (e) {}
        }

        const titleMatches = [...html.matchAll(/<h3[^>]*class="[^"]*LC20lb[^"]*"[^>]*>([\s\S]*?)<\/h3>/g)];
        titleMatches.forEach((m, i) => {
          if (pageResults[i]) pageResults[i].title = m[1].replace(/<[^>]+>/g, '').trim();
        });

        pageResults.forEach((r, i) => {
          const pos = start + i + 1;
          results.push({ ...r, position: pos });

          if (!exportMode && foundPosition < 0 && r.domain.toLowerCase().includes(domain.toLowerCase())) {
            foundPosition = pos;
            foundDomain = r.domain;
            foundTitle = r.title;
          }
        });

        if (page < startPage + pages - 1) await new Promise(resolve => setTimeout(resolve, 400));

      } catch (e) {
        break;
      }
    }

    if (exportMode) {
      sendResponse({ ok: true, allResults: results, totalChecked: results.length });
    } else {
      sendResponse({
        ok: true,
        found: foundPosition >= 0,
        position: foundPosition,
        domain: foundDomain,
        title: foundTitle,
        totalChecked: results.length,
        pagesChecked: Math.ceil(results.length / 10)
      });
    }
    cleanup();

  })();
}

// ─── SERP Fetch Page ───────────────────────────────────────────────
function handleSERPFetchPage(msg, sendResponse, cleanup) {
  const { query, startOffset = 0, gl, hl, near } = msg;
  let url = 'https://www.google.com/search'
    + '?q=' + encodeURIComponent(query)
    + '&num=10&start=' + startOffset
    + '&hl=' + encodeURIComponent(hl || 'en');
  if (gl) url += '&gl=' + encodeURIComponent(String(gl).toLowerCase());
  if (near) url += '&near=' + encodeURIComponent(near);

  (async () => {
    let tabId = null;

    try {
      const tab = await chrome.tabs.create({ url, active: false });
      tabId = tab.id;

      // Wait for load — avoid race if tab is already "complete"
      await new Promise((resolve, reject) => {
        const timeoutMs = Math.max(18000, Number(msg.loadTimeoutMs) || 20000);
        const timeout = setTimeout(() => reject(new Error('Tab load timeout')), timeoutMs);
        const done = () => {
          clearTimeout(timeout);
          try { chrome.tabs.onUpdated.removeListener(listener); } catch (_) {}
          resolve();
        };
        const listener = (id, info) => {
          if (id === tabId && info.status === 'complete') done();
        };
        chrome.tabs.onUpdated.addListener(listener);
        // If already loaded (fast cache), resolve soon
        chrome.tabs.get(tabId).then((t) => {
          if (t && t.status === 'complete') done();
        }).catch(() => {});
      });

      // Longer settle so organic results fully render (more accurate SERP)
      const settleMs = Math.max(2500, Math.min(6000, Number(msg.settleMs) || 3500));
      await new Promise(r => setTimeout(r, settleMs));

      // Guard against injecting mid-navigation: chrome.tabs.onUpdated can
      // fire "complete" on an intermediate hop (about:blank, a redirect)
      // before the tab has actually settled on the Google results page.
      // Confirm the tab's current URL looks right first — retrying briefly
      // if not — since executeScript on a not-yet-landed tab throws
      // "Cannot access contents of the page..." even with correct
      // host_permissions.
      for (let i = 0; i < 10; i++) {
        let t;
        try { t = await chrome.tabs.get(tabId); } catch (_) { break; }
        if (t && t.url && /\/search(\?|$)/.test(t.url) && t.status === 'complete') break;
        await new Promise(r => setTimeout(r, 400));
      }

      async function runExtraction(attemptsLeft, delayMs) {
        try {
          return await chrome.scripting.executeScript({
            target: { tabId },
            func: serpExtractorFn
          });
        } catch (e) {
          const em = e && e.message ? e.message : String(e);
          const isAccessErr = /cannot access contents of the page|manifest must request permission|no tab with id|no frame with id/i.test(em);
          if (isAccessErr && attemptsLeft > 0) {
            // Re-confirm the tab has actually landed before retrying —
            // executeScript can keep failing on an intermediate hop even
            // after the settle wait above, especially on slow connections.
            for (let i = 0; i < 3; i++) {
              let t;
              try { t = await chrome.tabs.get(tabId); } catch (_) { break; }
              if (t && t.url && /\/search(\?|$)/.test(t.url) && t.status === 'complete') break;
              await new Promise(r => setTimeout(r, 300));
            }
            await new Promise(r => setTimeout(r, delayMs));
            return runExtraction(attemptsLeft - 1, Math.min(delayMs * 1.6, 2500));
          }
          throw e;
        }
      }

      function serpExtractorFn() {
          const out = [];
          const seen = new Set();

          // Captcha / consent walls
          if (document.querySelector('#captcha-form, #recaptcha, form[action*="sorry"], #challenge-form')) {
            return { __captcha: true, items: [], hasAiOverview: false };
          }

          // AI Overview detection (best-effort)
          let hasAiOverview = false;
          try {
            hasAiOverview = !!(
              document.querySelector('.ULSxyf .MzVe4d, .hdzaWe, .YzScba, .AIOverview, #eKIzJc, [data-attrid="wa:/description"]') ||
              Array.from(document.querySelectorAll('h1, h2, span, div')).some((el) => {
                const t = (el.textContent || '').trim().toLowerCase();
                return t === 'ai overview' || (t.startsWith('ai overview') && t.length < 48);
              })
            );
          } catch (_) {}

          function resolveDestinationUrl(a, container) {
            if (!a) return null;
            let href = a.getAttribute('href') || a.href || '';

            if (href.startsWith('/url?') || href.includes('google.com/url?')) {
              try {
                const u = href.startsWith('http') ? new URL(href) : new URL(href, 'https://www.google.com');
                const q = u.searchParams.get('q') || u.searchParams.get('url');
                if (q && q.startsWith('http')) href = q;
              } catch (e) {}
            }

            // Aug 2026+ google.com/goto passthrough
            if (/google\.[^/]+\/goto/i.test(href) || href.includes('/goto?')) {
              try {
                const u = new URL(href, 'https://www.google.com');
                let raw = u.searchParams.get('url') || u.searchParams.get('q') || '';
                if (raw) {
                  if (raw.startsWith('http')) {
                    href = raw;
                  } else {
                    try {
                      const dec = decodeURIComponent(raw);
                      if (dec.startsWith('http')) href = dec;
                    } catch (e) {}
                    if (!href.startsWith('http') || /google\.[^/]+\/goto/i.test(href)) {
                      try {
                        let b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
                        while (b64.length % 4) b64 += '=';
                        const decoded = atob(b64);
                        if (decoded.startsWith('http')) href = decoded;
                      } catch (e) {}
                    }
                  }
                }
              } catch (e) {}
            }

            if (!href.startsWith('http') || /google\.[^/]+\/(goto|url)/i.test(href)) {
              const dataUrl = a.getAttribute('data-href') || a.getAttribute('data-url') || a.getAttribute('ping') || '';
              if (dataUrl && dataUrl.startsWith('http') && !/google\.[^/]+\/(goto|url|search)/i.test(dataUrl)) {
                href = dataUrl;
              }
            }

            // Visible cite / green URL fallback
            if (!href.startsWith('http') || /google\.[^/]+\/(goto|url|search)/i.test(href)) {
              const root = container || a.closest('.g, .MjjYud, .tF2Cxc, [data-hveid], [data-sokoban-container]') || a.parentElement;
              if (root) {
                const cite = root.querySelector('cite, .tjvcx, .qLRxge, .ulCwxb, .xBegd');
                if (cite) {
                  let citeText = (cite.textContent || '').trim().split(/[›>]/)[0].trim();
                  citeText = citeText.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[\s\/]/)[0];
                  if (citeText && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(citeText)) {
                    href = 'https://' + citeText;
                  }
                }
                if (!href.startsWith('http') || /google\./i.test(href)) {
                  const display = root.querySelector('.TbwUpd, .iUh30, .qLRxge cite, .ylgj0e');
                  if (display) {
                    let t = (display.textContent || '').trim().split(/[›>]/)[0].trim();
                    t = t.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[\s\/]/)[0];
                    if (t && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)) {
                      href = 'https://' + t;
                    }
                  }
                }
              }
            }

            if (!href || !href.startsWith('http')) return null;
            try {
              const host = new URL(href).hostname.toLowerCase();
              if (host.includes('google.') || host.includes('gstatic.') || host.includes('googleapis.')) return null;
            } catch (e) { return null; }
            return href;
          }

          function isAd(el) {
            return !!(el.querySelector('[data-text-ad]') || el.closest('[data-text-ad]') ||
              el.closest('.ads-visurl') || el.closest('[aria-label="Ads"]') ||
              el.closest('.commercial-unit-desktop-top') || el.closest('.pla-unit'));
          }

          const containerSelectors = [
            '#rso .g', '#search .MjjYud', '#rso .MjjYud',
            '#search div.g:not(div.g div.g)', '.tF2Cxc', 'div.g',
            'div[data-sokoban-container]', '#rso > div'
          ];
          let containers = [];

          for (const sel of containerSelectors) {
            containers = Array.from(document.querySelectorAll(sel)).filter(el => {
              const h3 = el.querySelector('h3');
              if (!h3 || isAd(el)) return false;
              if (el.parentElement && el.parentElement.closest('.g, .MjjYud')) return false;
              return true;
            });
            if (containers.length >= 3) break;
          }

          const pushFrom = (h3, a, container) => {
            const href = resolveDestinationUrl(a, container);
            if (!href) return;
            let domain = '';
            try { domain = new URL(href).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) {}
            if (!domain || domain.includes('google.') || seen.has(domain)) return;
            seen.add(domain);
            const snipEl = (container || h3).querySelector?.('.VwiC3b, .yDYNvb, .s3v9rd, [data-sncf], .st, .IsZvec');
            const snippet = (snipEl && snipEl.textContent.trim()) || '';
            out.push({
              title: (h3 && h3.textContent.trim()) || (a && a.textContent.trim()) || '',
              url: href,
              domain,
              snippet
            });
          };

          if (containers.length === 0) {
            document.querySelectorAll('#search h3, #rso h3, #center_col h3').forEach(h3 => {
              if (isAd(h3)) return;
              const a = h3.closest('a[href]') || h3.querySelector('a[href]');
              if (!a) return;
              const container = h3.closest('.g, .MjjYud, .tF2Cxc, [data-hveid]') || h3.parentElement;
              pushFrom(h3, a, container);
            });
            // Structural fallback
            if (out.length < 3) {
              try {
                document.querySelectorAll('a:has(h3)').forEach(a => {
                  if (isAd(a)) return;
                  const h3 = a.querySelector('h3');
                  if (!h3) return;
                  pushFrom(h3, a, a.parentElement);
                });
              } catch (e) {}
            }
            return { items: out, hasAiOverview };
          }

          for (const el of containers) {
            const h3 = el.querySelector('h3');
            if (!h3) continue;
            let a = el.querySelector('.yuRUbf > a[href], h3 a[href], a[href^="http"], a[href^="/url"], a[href*="/goto"]');
            if (!a) a = h3.closest('a[href]') || el.querySelector('a[href]');
            if (!a) continue;
            pushFrom(h3, a, el);
          }

          return { items: out, hasAiOverview };
      }

      const results = await runExtraction(6, 700);

      try { await chrome.tabs.remove(tabId); } catch (_) {}
      tabId = null;

      const payload = results?.[0]?.result;
      if (payload && payload.__captcha) {
        sendResponse({ ok: false, error: 'Google captcha — try again or use optional Serper key', results: [], hasAiOverview: false });
      } else {
        const list = Array.isArray(payload) ? payload : (payload?.items || payload?.results || []);
        const hasAiOverview = !!(payload && !Array.isArray(payload) && payload.hasAiOverview);
        // Attach positions for consumers
        const numbered = (list || []).map((r, i) => ({ ...r, position: r.position || i + 1 }));
        sendResponse({ ok: true, results: numbered, hasAiOverview });
      }
      cleanup();

    } catch(err) {
      if (tabId) { try { await chrome.tabs.remove(tabId); } catch(e) {} }
      const em = err && err.message ? err.message : String(err || '');
      const isAccessErr = /cannot access contents of the page|manifest must request permission|no tab with id|no frame with id/i.test(em);
      const friendly = isAccessErr
        ? 'The results page took too long to finish loading. This can happen on a slow connection — try again in a moment.'
        : (em || 'Tab fetch failed');
      sendResponse({ ok: false, error: friendly });
      cleanup();
    }
  })();
}

// ─── Rank Tracker: paid SERP API check ─────────────────────────────
// Supports Serper.dev (cheap, simple) and SerpApi (full-featured).
// Returns the same shape regardless of provider so popup.js can treat
// API results and free-scrape results identically.
function _rtDomainMatches(linkHost, targetDomain) {
  const a = (linkHost || '').replace(/^www\./, '').toLowerCase();
  const b = (targetDomain || '').replace(/^www\./, '').toLowerCase();
  if (!a || !b) return false;
  return a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
}

function handleRankApiCheck(msg, sendResponse, cleanup) {
  const { keyword, domain, provider, apiKey } = msg;

  (async () => {
    if (!keyword || !domain) { sendResponse({ ok: false, error: 'Missing keyword or domain' }); cleanup(); return; }
    if (!apiKey) { sendResponse({ ok: false, error: 'No Rank API key configured' }); cleanup(); return; }

    try {
      let organic = [];

      if (provider === 'serpapi') {
        const url = 'https://serpapi.com/search.json?engine=google&num=100'
          + '&q=' + encodeURIComponent(keyword)
          + '&api_key=' + encodeURIComponent(apiKey);
        const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status));
        organic = (data.organic_results || []).map(r => ({
          position: r.position, link: r.link, title: r.title
        }));
      } else {
        // Default / 'serper': Serper.dev
        const resp = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: keyword, num: 100 }),
          signal: AbortSignal.timeout(15000)
        });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.message || data.error || ('HTTP ' + resp.status));
        organic = (data.organic || []).map((r, i) => ({
          position: r.position || (i + 1), link: r.link, title: r.title
        }));
      }

      let found = null;
      for (const r of organic) {
        let host = '';
        try { host = new URL(r.link).hostname; } catch (e) { continue; }
        if (_rtDomainMatches(host, domain)) { found = r; break; }
      }

      sendResponse({
        ok: true,
        found: !!found,
        position: found ? found.position : null,
        page: found ? Math.ceil(found.position / 10) : null,
        url: found ? found.link : null,
        title: found ? found.title : null,
        totalChecked: organic.length,
        method: 'api'
      });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || 'Rank API request failed' });
    }
    cleanup();
  })();
}


// ─── Geocoding (OpenStreetMap Nominatim) ───────────────────────────
// Resolves a free-text place ("Doha, Qatar") to a lat/lng center point.
function handleGeocode(msg, sendResponse, cleanup) {
  (async () => {
    const q = (msg.query || '').trim();
    if (!q) { sendResponse({ ok: false, error: 'No location' }); cleanup(); return; }
    const ck = 'geocode_' + q.toLowerCase().replace(/\s+/g, '_').slice(0, 80);
    try {
      const cached = await getPersistentCache(ck);
      if (cached?.ok) { sendResponse(cached); cleanup(); return; }
    } catch (_) {}
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q);
      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'ShahzaibSEO-Extension/4.5 (local SEO grid)' },
        signal: AbortSignal.timeout(12000)
      });
      if (!resp.ok) { sendResponse({ ok: false, error: 'Geocoder HTTP ' + resp.status }); cleanup(); return; }
      const arr = await resp.json();
      if (!Array.isArray(arr) || !arr.length) { sendResponse({ ok: false, error: 'Location not found' }); cleanup(); return; }
      const result = { ok: true, lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon), displayName: arr[0].display_name || q };
      await setPersistentCache(ck, result);
      sendResponse(result); cleanup();
    } catch (e) {
      sendResponse({ ok: false, error: e.message || 'Geocode failed' }); cleanup();
    }
  })();
}

// ─── Local pack (map pack) check at a lat/lng point ─────────────────
// Serper.dev uses the /places endpoint (accepts `ll=@lat,lng,zoomz`).
// SerpApi uses engine=google with the `ll` GPS parameter.
// Both return the local map pack; we normalise to a common shape and locate
// the target business (by website domain and/or name) to get its position.
function _lpMatch(place, domain, businessName) {
  const wsHost = (() => { try { return new URL(place.website || '').hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; } })();
  const d = (domain || '').replace(/^www\./, '').toLowerCase();
  if (d && wsHost && (wsHost === d || wsHost.endsWith('.' + d) || d.endsWith('.' + wsHost))) return true;
  const bn = (businessName || '').trim().toLowerCase();
  const title = (place.title || '').trim().toLowerCase();
  if (bn && title && (title === bn || title.includes(bn) || bn.includes(title))) return true;
  return false;
}

function handleLocalPackCheck(msg, sendResponse, cleanup) {
  const { keyword, domain, businessName, provider, apiKey, lat, lng, zoom } = msg;
  (async () => {
    if (!keyword) { sendResponse({ ok: false, error: 'Missing keyword' }); cleanup(); return; }
    if (!apiKey) { sendResponse({ ok: false, error: 'No Rank API key configured' }); cleanup(); return; }
    const ll = (lat != null && lng != null) ? ('@' + lat + ',' + lng + ',' + (zoom || 14) + 'z') : '';

    try {
      let places = [];
      if (provider === 'serpapi') {
        let url = 'https://serpapi.com/search.json?engine=google&google_domain=google.com'
          + '&q=' + encodeURIComponent(keyword)
          + '&api_key=' + encodeURIComponent(apiKey);
        if (ll) url += '&ll=' + encodeURIComponent(ll);
        const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status));
        const lr = data.local_results;
        const raw = Array.isArray(lr) ? lr : (lr && Array.isArray(lr.places) ? lr.places : []);
        places = raw.map((r, i) => ({
          position: r.position || (i + 1),
          title: r.title || '',
          website: (r.links && r.links.website) || r.website || '',
          rating: r.rating != null ? r.rating : null,
          reviews: r.reviews != null ? r.reviews : (r.reviews_original ? parseInt(String(r.reviews_original).replace(/\D/g, ''), 10) : null),
          category: r.type || (Array.isArray(r.types) ? r.types[0] : '') || '',
          address: r.address || ''
        }));
      } else {
        // Serper.dev /places endpoint — accepts ll for GPS-accurate grid points.
        const body = { q: keyword };
        if (ll) body.ll = ll;
        const resp = await fetch('https://google.serper.dev/places', {
          method: 'POST',
          headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000)
        });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.message || data.error || ('HTTP ' + resp.status));
        places = (data.places || []).map((r, i) => ({
          position: r.position || (i + 1),
          title: r.title || '',
          website: r.website || '',
          rating: r.rating != null ? r.rating : null,
          reviews: r.ratingCount != null ? r.ratingCount : null,
          category: r.category || '',
          address: r.address || ''
        }));
      }

      let found = null;
      for (const p of places) { if (_lpMatch(p, domain, businessName)) { found = p; break; } }

      sendResponse({
        ok: true,
        found: !!found,
        position: found ? found.position : null,
        localResults: places.slice(0, 20),
        totalChecked: places.length,
        point: (lat != null && lng != null) ? { lat, lng } : null
      });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || 'Local pack request failed' });
    }
    cleanup();
  })();
}

// ─── Competitor analysis via background tab ─────────────────────────
// Opens a competitor URL in an inactive tab and runs the SAME content-script
// analysis pipeline as the current page, so GEO scores are directly comparable.
function handleCompetitorAnalyze(msg, sendResponse, cleanup) {
  const url = (msg.url || '').trim();
  (async () => {
    if (!/^https?:\/\//i.test(url)) { sendResponse({ ok: false, error: 'Invalid URL' }); cleanup(); return; }
    let tabId = null;
    try {
      const tab = await chrome.tabs.create({ url, active: false });
      tabId = tab.id;

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Tab load timeout')), 20000);
        const listener = (id, info) => {
          if (id === tabId && info.status === 'complete') {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });

      // Give the auto-injected content script a moment to settle, then request
      // analysis with a couple of retries in case it isn't listening yet.
      let analysis = null;
      for (let attempt = 0; attempt < 3 && !analysis; attempt++) {
        await new Promise(r => setTimeout(r, 1200));
        analysis = await new Promise(resolve => {
          try {
            chrome.tabs.sendMessage(tabId, { action: 'analyze' }, res => {
              if (chrome.runtime.lastError) return resolve(null);
              resolve(res || null);
            });
          } catch (_) { resolve(null); }
        });
      }

      try { await chrome.tabs.remove(tabId); } catch (_) {}
      tabId = null;

      if (!analysis) { sendResponse({ ok: false, error: 'Could not analyze competitor page' }); cleanup(); return; }
      sendResponse({ ok: true, analysis });
    } catch (err) {
      if (tabId) { try { await chrome.tabs.remove(tabId); } catch (_) {} }
      sendResponse({ ok: false, error: err.message || 'Competitor analysis failed' });
    }
    cleanup();
  })();
}

function handleAISERPAnalyze(msg, sendResponse, cleanup) {
  (async () => {
    try {
      const BUILTIN_GROQ = '';
      const stored = await new Promise(res =>
        chrome.storage.local.get([
          'aiProvider', 'nvidiaKey', 'nvidiaApiKey', 'openrouterKey', 'openrouterApiKey',
          'aiApiKey', 'groqApiKey', 'groqModel', 'nvidiaModel', 'openrouterModel', 'grokApiKey', 'grokModel'
        ], res)
      );

      let provider = msg.provider || stored.aiProvider || 'groq';
      const nvidiaKey = msg.nvidiaKey || stored.nvidiaKey || stored.nvidiaApiKey || stored.aiApiKey || '';
      const openrKey = msg.openrKey || stored.openrouterKey || stored.openrouterApiKey || '';
      const groqKey = msg.groqKey || stored.groqApiKey || BUILTIN_GROQ;
      const grokKey = msg.grokKey || stored.grokApiKey || '';

      // Prefer explicit keys; if none, fall back to built-in Groq
      let apiKey = '';
      if (provider === 'openrouter' && openrKey) apiKey = openrKey;
      else if (provider === 'nvidia' && nvidiaKey) apiKey = nvidiaKey;
      else if (provider === 'grok' && grokKey) apiKey = grokKey;
      else if (provider === 'groq' && groqKey) apiKey = groqKey;
      else if (msg.nvidiaKey || nvidiaKey) { provider = 'nvidia'; apiKey = nvidiaKey; }
      else if (openrKey) { provider = 'openrouter'; apiKey = openrKey; }
      else if (grokKey) { provider = 'grok'; apiKey = grokKey; }
      else { provider = 'groq'; apiKey = groqKey; }

      if (!apiKey) {
        sendResponse({ ok: false, error: 'No API key found. Built-in Groq unavailable.' });
        cleanup();
        return;
      }

      let model, endpoint, headers;
      if (provider === 'openrouter') {
        model = msg.model || stored.openrouterModel || 'meta-llama/llama-3.3-70b-instruct:free';
        endpoint = 'https://openrouter.ai/api/v1/chat/completions';
        headers = {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
          'HTTP-Referer': 'https://rankseo.ext',
          'X-Title': 'ShahzaibSEO'
        };
      } else if (provider === 'nvidia') {
        model = msg.model || stored.nvidiaModel || stored.aiModel || 'meta/llama-3.3-70b-instruct';
        endpoint = 'https://integrate.api.nvidia.com/v1/chat/completions';
        headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
      } else if (provider === 'grok') {
        model = msg.model || stored.grokModel || 'grok-2-latest';
        endpoint = 'https://api.x.ai/v1/chat/completions';
        headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
      } else {
        // groq (default / built-in)
        model = msg.model || stored.groqModel || 'llama-3.3-70b-versatile';
        endpoint = 'https://api.groq.com/openai/v1/chat/completions';
        headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
      }

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are an expert SEO analyst. Reply with valid JSON only. Date context: September 2026 — do not use 2024/2025.' },
            { role: 'user', content: msg.prompt }
          ],
          max_tokens: 800,
          temperature: 0.3
        })
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        sendResponse({ ok: false, error: errBody?.error?.message || `API error ${resp.status}` });
        cleanup();
        return;
      }

      const data = await resp.json();
      sendResponse({ ok: true, text: data?.choices?.[0]?.message?.content || '', provider: provider });
      cleanup();

    } catch(err) {
      sendResponse({ ok: false, error: err.message || 'Unknown error' });
      cleanup();
    }
  })();
}

// ─── Automation State Management ─────────────────────────────────
let automationState = {
  running: false,
  url: null,
  step: 0,
  percentage: 0,
  results: null
};

function handleAutomationState(msg, sendResponse, cleanup) {
  if (msg.action === 'AUTOMATION_GET_STATE') {
    sendResponse({
      running: automationState.running,
      url: automationState.url,
      step: automationState.step,
      percentage: automationState.percentage,
      results: automationState.results
    });
    cleanup();
    return true;
  }

  if (msg.action === 'AUTOMATION_UPDATE_STATE') {
    automationState = { ...automationState, ...msg.state };
    chrome.runtime.sendMessage({ action: 'AUTOMATION_STATE_CHANGED', state: automationState }).catch(() => {});
    sendResponse({ ok: true });
    cleanup();
    return true;
  }

  if (msg.action === 'AUTOMATION_CLEAR_STATE') {
    automationState = { running: false, url: null, step: 0, percentage: 0, results: null };
    sendResponse({ ok: true });
    cleanup();
    return true;
  }
}

// ─── Toolbar Analysis ───────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getAnalysis' && sender.tab) {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      func: () => {
        if (window.ShahzaibSEO) {
          try { return window.ShahzaibSEO.analyze(); } catch(e) { return null; }
        }
        return null;
      }
    }, (results) => {
      // Suppress "Unchecked runtime.lastError: Frame with ID 0 was removed"
      // when the tab navigates/closes while executeScript is in flight.
      void chrome.runtime.lastError;
      const data = results?.[0]?.result;
      sendResponse(data || null);
      if (data && sender.tab?.id) {
        try {
          chrome.tabs.sendMessage(sender.tab.id, { action: 'analysisReady', data }).catch(() => {});
        } catch (_) {}
      }
    });
    return true;
  }

  // ── SERP Page Info (SSR fetch: title, description, JSON-LD, headings) ──────
  if (msg.action === 'SERP_PAGE_INFO') {
    (async () => {
      const url = (msg.url || '').trim();
      if (!url || isRestrictedFetchUrl(url)) { sendResponse({ ok: false, blocked: true }); cleanup(); return; }

      // Use chrome.storage.local for persistent cache (survives SW restarts)
      let ck;
      try { ck = 'serpinfo_' + btoa(unescape(encodeURIComponent(url))).slice(0, 80); }
      catch (_) { ck = 'serpinfo_' + String(url).length + '_' + String(url).slice(0, 40).replace(/\W/g, ''); }
      try {
        const stored = await chrome.storage.local.get(ck);
        const entry = stored[ck];
        if (entry && entry.ts && (Date.now() - entry.ts) < 3600000) {
          sendResponse(entry.data);
          cleanup();
          return;
        }
      } catch (_) {}

      // keepAlive: prevent service worker from sleeping during fetch
      // by holding a dummy chrome.storage call in a loop
      let keepAliveTimer = setInterval(() => {
        chrome.storage.local.get('_ka').catch(() => {});
      }, 5000);

      try {
        // Strip common tracking params that sometimes break fetches
        let fetchUrl = url;
        try {
          const u = new URL(url);
          ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid','si'].forEach(p => u.searchParams.delete(p));
          fetchUrl = u.toString();
        } catch (_) {}

        const resp = await fetch(fetchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate'
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(14000)
        });

        clearInterval(keepAliveTimer);

        if (!resp.ok) { sendResponse({ ok: false }); cleanup(); return; }

        const html = await resp.text();

        // Decode HTML entities helper
        const dec = s => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').trim();

        // Parse title
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? dec(titleMatch[1]) : null;

        // Parse meta description (handles both attribute orders)
        const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i)
          || html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i);
        const description = descMatch ? dec(descMatch[1]) : null;

        // Extract JSON-LD blocks
        const jsonLdBlocks = [];
        const jsonLdRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let jm;
        while ((jm = jsonLdRe.exec(html)) !== null) {
          try { jsonLdBlocks.push(JSON.parse(jm[1].trim())); } catch(_) {}
        }

        // Extract headings H1-H3 (max 30 to keep payload small)
        const headings = [];
        const headingRe = /<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/gi;
        let hm;
        while ((hm = headingRe.exec(html)) !== null && headings.length < 30) {
          const level = hm[1].toLowerCase();
          // Strip all tags, decode entities, collapse whitespace
          const rawText = hm[2].replace(/<[^>]+>/g, ' ');
          const text = dec(rawText).replace(/\s+/g, ' ').trim();
          if (text) headings.push({ level, text });
        }

        // Word count from main content (strip chrome: nav/footer/script/style)
        let wordCount = 0;
        try {
          let bodyHtml = html;
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
          if (bodyMatch) bodyHtml = bodyMatch[1];
          const textOnly = bodyHtml
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
            .replace(/<!--[\s\S]*?-->/g, ' ')
            .replace(/<(nav|footer|header|aside|form|iframe|svg)[\s\S]*?<\/\1>/gi, ' ')
            .replace(/<(nav|footer|header|aside|form|iframe|svg)\b[^>]*\/>/gi, ' ')
            .replace(/<[^>]+>/g, ' ');
          const decoded = dec(textOnly.replace(/&nbsp;/gi, ' ').replace(/&#\d+;/g, ' '));
          const tokens = decoded.replace(/\s+/g, ' ').trim().split(' ').filter(w => {
            if (!w || w.length < 2) return false;
            // keep words with at least one letter (any script)
            return /[\p{L}\p{N}]/u.test(w);
          });
          wordCount = tokens.length;
        } catch (_) {
          try {
            const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            wordCount = plain ? plain.split(' ').filter(Boolean).length : 0;
          } catch (_2) {}
        }

        const result = { ok: true, title, description, jsonLd: jsonLdBlocks, headings, wordCount };

        // Cache in local storage (1 hour TTL)
        try { await chrome.storage.local.set({ [ck]: { data: result, ts: Date.now() } }); } catch(_) {}

        sendResponse(result);
        cleanup();
      } catch (e) {
        clearInterval(keepAliveTimer);
        sendResponse({ ok: false, error: String(e.message || e) });
        cleanup();
      }
    })();
    return true;
  }

  // ── Ahrefs Quick Check — open traffic-checker / backlink-checker tab and auto-fill ──
  if (msg.action === 'AHREFS_OPEN_CHECK') {
    (async () => {
      const target = (msg.url || '').trim();
      const mode = msg.mode; // 'traffic' | 'backlinks' | 'both'
      if (!target) { sendResponse({ ok: false, error: 'No URL provided.' }); cleanup(); return; }

      const AHREFS_TAB_DELAY = 300;
      const AHREFS_LOAD_DELAY = 2000;
      const AHREFS_RETRY_INTERVAL = 500;
      const AHREFS_MAX_RETRIES = 20;

      const FORMS = {
        traffic: {
          pageUrl: 'https://ahrefs.com/traffic-checker/',
          inputSelector: 'input[placeholder="Enter domain or URL"]',
          buttonText: 'Check traffic'
        },
        backlinks: {
          pageUrl: 'https://ahrefs.com/backlink-checker',
          inputSelector: 'input[placeholder="Enter domain or URL"]',
          buttonText: 'Check backlinks'
        }
      };

      function injectFormFiller(tabId, inputUrl, formConfig) {
        return chrome.scripting.executeScript({
          target: { tabId },
          func: (val, cfg, retryInterval, maxRetries) => {
            let attempts = 0;
            const tryFill = setInterval(() => {
              attempts++;
              const input = document.querySelector(cfg.inputSelector);
              const button = [...document.querySelectorAll('button')]
                .find(btn => btn.textContent.includes(cfg.buttonText));
              if (input && button) {
                input.value = val;
                ['input', 'change'].forEach(t => input.dispatchEvent(new Event(t, { bubbles: true })));
                setTimeout(() => button.click(), 100);
                clearInterval(tryFill);
              } else if (attempts >= maxRetries) {
                clearInterval(tryFill);
              }
            }, retryInterval);
          },
          args: [inputUrl, { inputSelector: formConfig.inputSelector, buttonText: formConfig.buttonText }, AHREFS_RETRY_INTERVAL, AHREFS_MAX_RETRIES]
        });
      }

      function createAndFillTab(formConfig, inputUrl) {
        return new Promise((resolve) => {
          chrome.tabs.create({ url: formConfig.pageUrl, active: false }, (tab) => {
            setTimeout(() => {
              injectFormFiller(tab.id, inputUrl, formConfig)
                .then(() => resolve(tab))
                .catch((err) => { console.warn('[RP] Ahrefs inject failed:', err); resolve(tab); });
            }, AHREFS_LOAD_DELAY);
          });
        });
      }

      try {
        if (mode === 'traffic') {
          await createAndFillTab(FORMS.traffic, target);
        } else if (mode === 'backlinks') {
          await createAndFillTab(FORMS.backlinks, target);
        } else if (mode === 'both') {
          await createAndFillTab(FORMS.traffic, target);
          setTimeout(() => createAndFillTab(FORMS.backlinks, target), AHREFS_TAB_DELAY);
        }
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e.message || e) });
      }
      cleanup();
    })();
    return true;
  }


  if (msg.action === 'WAYBACK_CDX') {
    (async () => {
      const domain = (msg.domain || '').replace(/^www\./, '');
      const blogPath = msg.blogPath || '';
      const ck = 'wayback_cdx_' + domain + (blogPath ? '_' + blogPath.replace(/\//g, '_') : '');
      // 1) Session cache
      try {
        const cached = await getCachedData(ck);
        if (cached?.ok) { sendResponse(cached); cleanup(); return; }
      } catch (_) {}
      // 2) Persistent cache (24 h)
      try {
        const persistent = await getPersistentCache(ck);
        if (persistent?.ok) {
          await setCachedData(ck, persistent, CONFIG.LONG_CACHE_TTL);
          sendResponse(persistent); cleanup(); return;
        }
      } catch (_) {}
      try {
        // Use matchType=domain for optimised index lookup; fl= reduces payload size.
        // blogPath mode keeps prefix match with a tighter field filter.
        const baseUrl = blogPath
          ? `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain + '/' + blogPath)}&matchType=prefix&output=json&fl=timestamp,original,statuscode&limit=100&filter=statuscode:200&collapse=digest`
          : `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&matchType=domain&output=json&fl=timestamp,original,statuscode&limit=50&collapse=digest`;

        // CDX can be slow — retry up to 3 times with escalating timeouts
        let resp = null;
        const timeouts = [15000, 22000, 30000];
        for (let attempt = 0; attempt < timeouts.length; attempt++) {
          try {
            resp = await fetch(baseUrl, { signal: AbortSignal.timeout(timeouts[attempt]) });
            if (resp.ok) break;
            resp = null;
          } catch (fetchErr) {
            if (attempt === timeouts.length - 1) throw fetchErr;
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          }
        }
        if (!resp || !resp.ok) {
          sendResponse({ ok: false, error: resp ? `HTTP ${resp.status}` : 'All retries failed' });
          cleanup(); return;
        }

        // CDX occasionally returns an HTML error page even on HTTP 200 — guard the parse
        const text = await resp.text();
        let raw;
        try { raw = JSON.parse(text); } catch (_) {
          sendResponse({ ok: false, error: 'Invalid JSON from CDX' }); cleanup(); return;
        }
        if (!Array.isArray(raw) || raw.length === 0) {
          // Empty = no snapshots yet, not an error
          const result = { ok: true, snapshots: [], total: 0 };
          await setCachedData(ck, result, CONFIG.LONG_CACHE_TTL);
          await setPersistentCache(ck, result);
          sendResponse(result); cleanup(); return;
        }
        // First row is header
        const headers = raw[0];
        const rows = raw.slice(1).map(r => {
          const obj = {};
          headers.forEach((h, i) => { obj[h] = r[i]; });
          return obj;
        });
        const result = { ok: true, snapshots: rows, total: rows.length };
        await setCachedData(ck, result, CONFIG.LONG_CACHE_TTL);
        await setPersistentCache(ck, result);
        sendResponse(result); cleanup();
      } catch (e) {
        sendResponse({ ok: false, error: e.message }); cleanup();
      }
    })();
    return true;
  }

  // ── Archive Availability (quick check) ───────────────────────────
  if (msg.action === 'ARCHIVE_AVAILABLE') {
    (async () => {
      const url = (msg.url || '').trim();
      const ck = 'archive_avail_' + url;
      try {
        const cached = await getCachedData(ck);
        if (cached?.ok) { sendResponse(cached); cleanup(); return; }
      } catch (_) {}
      try {
        const resp = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
        if (!resp.ok) { sendResponse({ ok: false }); cleanup(); return; }
        const data = await resp.json();
        const snap = data?.archived_snapshots?.closest;
        const result = { ok: true, available: !!snap, snapshot: snap || null };
        await setCachedData(ck, result, CONFIG.CACHE_TTL);
        sendResponse(result); cleanup();
      } catch (e) {
        sendResponse({ ok: false, error: e.message }); cleanup();
      }
    })();
    return true;
  }

  // ── Google Keyword Suggestions ───────────────────────────────────
  if (msg.action === 'KEYWORD_SUGGEST') {
    (async () => {
      const kw = (msg.keyword || '').trim();
      if (!kw) { sendResponse({ ok: false, error: 'No keyword' }); cleanup(); return; }
      const ck = 'kw_suggest_' + kw.toLowerCase().replace(/\s+/g, '_').slice(0, 80);
      try {
        const cached = await getCachedData(ck);
        if (cached?.ok) { sendResponse(cached); cleanup(); return; }
      } catch (_) {}
      try {
        const url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(kw)}&hl=en`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!resp.ok) { sendResponse({ ok: false }); cleanup(); return; }
        const data = await resp.json();
        // data[1] = suggestions array
        const suggestions = data[1] || [];
        const result = { ok: true, keyword: kw, suggestions };
        await setCachedData(ck, result, CONFIG.CACHE_TTL);
        sendResponse(result); cleanup();
      } catch (e) {
        sendResponse({ ok: false, error: e.message }); cleanup();
      }
    })();
    return true;
  }

  // ── DNS Records ──────────────────────────────────────────────────
  if (msg.action === 'DNS_LOOKUP') {
    (async () => {
      const domain = (msg.domain || '').replace(/^www\./, '');
      const types = msg.types || ['A', 'MX', 'TXT', 'NS', 'CNAME'];
      const ck = 'dns_' + domain;
      // 1) Session cache
      try {
        const cached = await getCachedData(ck);
        if (cached?.ok) { sendResponse(cached); cleanup(); return; }
      } catch (_) {}
      // 2) Persistent cache (24 h)
      try {
        const persistent = await getPersistentCache(ck);
        if (persistent?.ok) {
          await setCachedData(ck, persistent, CONFIG.LONG_CACHE_TTL);
          sendResponse(persistent); cleanup(); return;
        }
      } catch (_) {}
      try {
        const results = {};
        await Promise.all(types.map(async (type) => {
          try {
            const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`, { signal: AbortSignal.timeout(8000) });
            if (r.ok) {
              const d = await r.json();
              results[type] = (d.Answer || []).map(a => ({ name: a.name, ttl: a.TTL, data: a.data }));
            } else {
              results[type] = [];
            }
          } catch (_) { results[type] = []; }
        }));
        const result = { ok: true, domain, records: results };
        await setCachedData(ck, result, CONFIG.LONG_CACHE_TTL);
        await setPersistentCache(ck, result);
        sendResponse(result); cleanup();
      } catch (e) {
        sendResponse({ ok: false, error: e.message }); cleanup();
      }
    })();
    return true;
  }

  // ── Certificate Transparency (main domain + subdomains) ──────────
  if (msg.action === 'CERT_LOOKUP') {
    (async () => {
      const domain = (msg.domain || '').replace(/^www\./, '');
      const subdomains = msg.subdomains === true;
      const ck = 'crt_' + (subdomains ? 'sub_' : '') + domain;
      // 1) Session cache
      try {
        const cached = await getCachedData(ck);
        if (cached?.ok) { sendResponse(cached); cleanup(); return; }
      } catch (_) {}
      // 2) Persistent cache (24 h)
      try {
        const persistent = await getPersistentCache(ck);
        if (persistent?.ok) {
          await setCachedData(ck, persistent, CONFIG.LONG_CACHE_TTL);
          sendResponse(persistent); cleanup(); return;
        }
      } catch (_) {}
      try {
        const q = subdomains ? `%.${domain}` : domain;
        const crtUrl = `https://crt.sh/?q=${encodeURIComponent(q)}&output=json`;
        // crt.sh can be slow/flaky — retry up to 3 times with increasing timeouts
        let resp = null;
        const timeouts = [12000, 18000, 25000];
        for (let attempt = 0; attempt < timeouts.length; attempt++) {
          try {
            resp = await fetch(crtUrl, { signal: AbortSignal.timeout(timeouts[attempt]) });
            if (resp.ok) break;
            resp = null; // retry on non-ok
          } catch (fetchErr) {
            if (attempt === timeouts.length - 1) throw fetchErr; // rethrow on last attempt
            await new Promise(r => setTimeout(r, 800 * (attempt + 1))); // back-off
          }
        }
        if (!resp || !resp.ok) { sendResponse({ ok: false, error: resp ? `HTTP ${resp.status}` : 'All retries failed' }); cleanup(); return; }
        const data = await resp.json();
        // Deduplicate by common_name
        const seen = new Set();
        const certs = (Array.isArray(data) ? data : []).filter(c => {
          const key = (c.common_name || c.name_value || '').toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key); return true;
        }).slice(0, 200).map(c => ({
          id: c.id,
          name: c.common_name || c.name_value,
          issuer: c.issuer_name,
          notBefore: c.not_before,
          notAfter: c.not_after
        }));
        const result = { ok: true, domain, subdomains, certs, total: certs.length };
        await setCachedData(ck, result, CONFIG.LONG_CACHE_TTL);
        await setPersistentCache(ck, result);
        sendResponse(result); cleanup();
      } catch (e) {
        sendResponse({ ok: false, error: e.message }); cleanup();
      }
    })();
    return true;
  }

  // ── IP Geolocation ───────────────────────────────────────────────
  if (msg.action === 'IP_GEO') {
    (async () => {
      const target = (msg.domain || '').replace(/^www\./, '').replace(/^https?:\/\//, '');
      const ck = 'ipgeo_' + target;
      // 1) Session cache (fast, in-memory)
      try {
        const cached = await getCachedData(ck);
        if (cached?.ok) { sendResponse(cached); cleanup(); return; }
      } catch (_) {}
      // 2) Persistent cache (24 h, survives SW restarts)
      try {
        const persistent = await getPersistentCache(ck);
        if (persistent?.ok) {
          await setCachedData(ck, persistent, CONFIG.LONG_CACHE_TTL); // warm session cache
          sendResponse(persistent); cleanup(); return;
        }
      } catch (_) {}
      try {
        const resp = await fetch(`http://ip-api.com/json/${encodeURIComponent(target)}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query`, { signal: AbortSignal.timeout(8000) });
        if (!resp.ok) { sendResponse({ ok: false }); cleanup(); return; }
        const data = await resp.json();
        if (data.status === 'fail') {
          // Fallback to ipwhois
          const r2 = await fetch(`https://ipwhois.app/json/${encodeURIComponent(target)}`, { signal: AbortSignal.timeout(8000) });
          if (r2.ok) {
            const d2 = await r2.json();
            const result = { ok: true, ip: d2.ip, country: d2.country, countryCode: d2.country_code, region: d2.region, city: d2.city, isp: d2.isp, org: d2.org, asn: d2.asn, timezone: d2.timezone, lat: d2.latitude, lon: d2.longitude };
            await setCachedData(ck, result, CONFIG.LONG_CACHE_TTL);
            await setPersistentCache(ck, result);
            sendResponse(result); cleanup(); return;
          }
          sendResponse({ ok: false, error: data.message }); cleanup(); return;
        }
        const result = { ok: true, ip: data.query, country: data.country, countryCode: data.countryCode, region: data.regionName, city: data.city, isp: data.isp, org: data.org, asn: data.as, timezone: data.timezone, lat: data.lat, lon: data.lon };
        await setCachedData(ck, result, CONFIG.LONG_CACHE_TTL);
        await setPersistentCache(ck, result);
        sendResponse(result); cleanup();
      } catch (e) {
        sendResponse({ ok: false, error: e.message }); cleanup();
      }
    })();
    return true;
  }

  // ── HTTP Headers Analysis (HackerTarget) ─────────────────────────
  if (msg.action === 'HTTP_HEADERS') {
    (async () => {
      const domain = (msg.domain || '').replace(/^www\./, '');
      const ck = 'http_headers_' + domain;
      // 1) Session cache
      try {
        const cached = await getCachedData(ck);
        if (cached?.ok) { sendResponse(cached); cleanup(); return; }
      } catch (_) {}
      // 2) Persistent cache (24 h)
      try {
        const persistent = await getPersistentCache(ck);
        if (persistent?.ok) {
          await setCachedData(ck, persistent, CONFIG.CACHE_TTL);
          sendResponse(persistent); cleanup(); return;
        }
      } catch (_) {}
      try {
        const resp = await fetch(`https://api.hackertarget.com/httpheaders/?q=${encodeURIComponent(domain)}`, { signal: AbortSignal.timeout(10000) });
        if (!resp.ok) { sendResponse({ ok: false }); cleanup(); return; }
        const text = await resp.text();
        // Parse headers from plain text format "Key: Value"
        const headers = [];
        text.split('\n').forEach(line => {
          const colon = line.indexOf(':');
          if (colon > 0) {
            const name = line.slice(0, colon).trim();
            const value = line.slice(colon + 1).trim();
            if (name && value) headers.push({ name, value });
          }
        });
        // Security header presence analysis
        const securityHeaders = ['content-security-policy','x-frame-options','x-content-type-options','strict-transport-security','permissions-policy','referrer-policy','x-xss-protection'];
        const headerNames = headers.map(h => h.name.toLowerCase());
        const security = securityHeaders.map(h => ({ header: h, present: headerNames.includes(h) }));
        const result = { ok: true, domain, headers, security };
        await setCachedData(ck, result, CONFIG.CACHE_TTL);
        await setPersistentCache(ck, result);
        sendResponse(result); cleanup();
      } catch (e) {
        sendResponse({ ok: false, error: e.message }); cleanup();
      }
    })();
    return true;
  }

  // ── Clear Technical-tab persistent cache (called by refresh buttons) ─
  if (msg.action === 'CLEAR_TECH_CACHE') {
    (async () => {
      const keys = Array.isArray(msg.keys) ? msg.keys : [];
      await Promise.all(keys.map(k => clearPersistentCache(k)));
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.action === 'openPopup') {
    chrome.action.openPopup?.().catch(() => {});
    sendResponse({ ok: true });
    return false;
  }
});

// ─── Keyboard Shortcuts ───────────────────────────────────────────
/**
 * Handle keyboard shortcuts for toggling toolbar and SERP sidebar
 */
chrome.commands.onCommand.addListener(async (command) => {
  console.log('[RP] Command received:', command);

  if (command === 'toggle-toolbar') {
    // Toggle toolbar visibility
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      console.warn('[RP] No active tab found for toolbar toggle');
      return;
    }

    console.log('[RP] Sending toggleToolbar message to tab:', tab.id);
    chrome.tabs.sendMessage(tab.id, { action: 'toggleToolbar' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[RP] Toolbar toggle failed:', chrome.runtime.lastError.message);
      } else {
        console.log('[RP] Toolbar toggle message sent successfully');
      }
    });
  }

  if (command === 'toggle-serp-sidebar') {
    // Toggle SERP sidebar visibility (only on Google search pages)
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;

    // Check if we're on a Google search page
    if (tab.url.includes('google.com/search')) {
      chrome.tabs.sendMessage(tab.id, { action: 'toggleSerpSidebar' }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('[RP] SERP sidebar toggle failed:', chrome.runtime.lastError.message);
        }
      });
    }
  }
});

console.log('[RP] Background service worker initialized');

async function handleSiteIndexation(msg, sendResponse, cleanup) {
  const domain = String(msg.domain || '').replace(/^www\./i, '').toLowerCase();
  if (!domain) {
    sendResponse({ ok: false, error: 'no_domain' });
    cleanup();
    return;
  }
  const query = 'site:' + domain;
  // Reuse SERP page fetch logic via internal call pattern
  try {
    const result = await new Promise((resolve) => {
      // Create a one-shot SERP fetch
      const url = 'https://www.google.com/search?q=' + encodeURIComponent(query) + '&hl=en&num=10';
      let tabId = null;
      const timeout = setTimeout(() => {
        if (tabId) chrome.tabs.remove(tabId).catch(() => {});
        resolve({ ok: false, error: 'timeout' });
      }, 14000);

      chrome.tabs.create({ url, active: false }, async (tab) => {
        if (chrome.runtime.lastError || !tab?.id) {
          clearTimeout(timeout);
          resolve({ ok: false, error: chrome.runtime.lastError?.message || 'tab_failed' });
          return;
        }
        tabId = tab.id;
        const onUpdated = (id, info) => {
          if (id !== tabId || info.status !== 'complete') return;
          chrome.tabs.onUpdated.removeListener(onUpdated);
          setTimeout(async () => {
            try {
              const [{ result: scraped }] = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                  const out = { estimatedCount: null, sampleUrls: [] };
                  const bodyText = document.body ? document.body.innerText : '';
                  // Result stats: "About 1,230 results" / "1,230 results"
                  const m = bodyText.match(/About\s+([\d,\.]+)\s+results/i)
                    || bodyText.match(/([\d,\.]+)\s+results/i);
                  if (m) {
                    const n = parseInt(m[1].replace(/[\.,]/g, ''), 10);
                    if (!isNaN(n)) out.estimatedCount = n;
                  }
                  // Sample organic links
                  const seen = new Set();
                  document.querySelectorAll('#search a[href], #rso a[href]').forEach(a => {
                    const href = a.href || '';
                    if (!href.startsWith('http') || href.includes('google.')) return;
                    try {
                      const u = new URL(href);
                      if (seen.has(u.href) || seen.size >= 8) return;
                      seen.add(u.href);
                      out.sampleUrls.push(u.href);
                    } catch (e) {}
                  });
                  // Captcha?
                  if (document.querySelector('#captcha-form, #recaptcha, form[action*="sorry"]')) {
                    out.captcha = true;
                  }
                  return out;
                }
              });
              clearTimeout(timeout);
              chrome.tabs.remove(tabId).catch(() => {});
              if (scraped?.captcha) {
                resolve({ ok: false, error: 'Google captcha — open site: manually' });
              } else {
                resolve({
                  ok: true,
                  estimatedCount: scraped?.estimatedCount ?? null,
                  sampleUrls: scraped?.sampleUrls || [],
                  source: 'Google site:'
                });
              }
            } catch (e) {
              clearTimeout(timeout);
              chrome.tabs.remove(tabId).catch(() => {});
              resolve({ ok: false, error: e.message });
            }
          }, 1200);
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
      });
    });
    sendResponse(result);
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
  cleanup();
}
// ═══════════════════════════════════════════════════════════════════
// Advanced SERP Multi-Page Auto-Scrape v3
// Ports proven SERP Scraper extension flow:
//   inject content/serp-multi-scraper.js → merge → advance pages
// ═══════════════════════════════════════════════════════════════════
const RS_SERP_RESULTS_KEY = 'rs_serp_multi_results';
const RS_SERP_AIO_KEY = 'rs_serp_multi_aio';
const RS_SERP_PAGES_KEY = 'rs_serp_multi_pages';
const RS_SERP_AUTO_KEY = 'rs_serp_auto_state';

function rsSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function rsIsGotoUrl(url) {
  try { return new URL(url).pathname === '/goto'; }
  catch { return false; }
}

function rsDetectEngine(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.hostname.includes('google.')) return 'google';
    if (u.hostname.includes('bing.')) return 'bing';
  } catch { /* ignore */ }
  return null;
}

function rsBuildPageUrl(engine, urlStr, pageNumber) {
  const u = new URL(urlStr);
  if (engine === 'google') {
    if (pageNumber <= 1) u.searchParams.delete('start');
    else u.searchParams.set('start', String((pageNumber - 1) * 10));
  } else if (engine === 'bing') {
    if (pageNumber <= 1) u.searchParams.delete('first');
    else u.searchParams.set('first', String((pageNumber - 1) * 10 + 1));
  }
  return u.toString();
}

async function rsGetAutoState() {
  const d = await chrome.storage.local.get([RS_SERP_AUTO_KEY]);
  return d[RS_SERP_AUTO_KEY] || null;
}

async function rsSetAutoState(state) {
  await chrome.storage.local.set({ [RS_SERP_AUTO_KEY]: state });
}

async function rsFinishAutoScrape(state, reason) {
  if (!state) return;
  state.active = false;
  state.done = true;
  state.finishReason = reason;
  state.finishedAt = new Date().toISOString();
  await rsSetAutoState(state);
  try { chrome.action.setBadgeText({ text: '' }); } catch (_) {}
  try {
    const msg =
      reason === 'completed'
        ? `Auto-scrape done! ${state.scrapedCount || 0} page(s) collected.`
        : reason === 'stopped'
          ? 'Auto-scrape stopped. Download what was collected.'
          : 'Auto-scrape stopped due to an error.';
    // Use absolute extension URL; tiny/corrupt icon128.png breaks notifications.
    // Prefer logo.png / rankpulse.png; omit icon if create still fails.
    const iconCandidates = [
      'icons/logo.png',
      'icons/rankpulse.png',
      'icons/icon48.png',
      'icons/icon128.png'
    ];
    let created = false;
    for (const rel of iconCandidates) {
      try {
        await chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL(rel),
          title: 'ShahzaibSEO Multi SERP',
          message: msg
        });
        created = true;
        break;
      } catch (_) { /* try next icon */ }
    }
    if (!created) {
      // Last resort: no iconUrl (some Chrome builds allow it)
      try {
        await chrome.notifications.create({
          type: 'basic',
          title: 'ShahzaibSEO Multi SERP',
          message: msg
        });
      } catch (_) {}
    }
  } catch (_) {}
}

/** Inject proven SERP multi-scraper (async IIFE returns payload). */
async function rsScrapeTab(tabId) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/serp-multi-scraper.js']
  });
  return injection && injection.result;
}

async function rsMergePayload(payload) {
  if (!payload) return { added: 0, aioAdded: false, total: 0, pages: 0, aioCount: 0 };

  const data = await chrome.storage.local.get([RS_SERP_RESULTS_KEY, RS_SERP_PAGES_KEY, RS_SERP_AIO_KEY]);
  let results = data[RS_SERP_RESULTS_KEY] || [];
  let pages = data[RS_SERP_PAGES_KEY] || [];
  let aioResults = data[RS_SERP_AIO_KEY] || [];

  const pageNum = payload.page || 1;
  const query = payload.query || '';
  const pageKey = pageNum + '|' + query;
  if (!pages.includes(pageKey)) pages.push(pageKey);

  const existingUrls = new Set(results.map((r) => r.url).filter(Boolean));
  let added = 0;

  (payload.results || []).forEach((r, idx) => {
    const url = r.url || '';
    // Allow /goto URLs (resolved later) — still store them
    if (!url) return;
    if (existingUrls.has(url)) return;
    existingUrls.add(url);

    let domain = '';
    try {
      if (!rsIsGotoUrl(url) && /^https?:\/\//i.test(url)) {
        domain = new URL(url).hostname.replace(/^www\./, '');
      }
    } catch (_) {}
    // Prefer breadcrumb-derived domain if /goto
    if (!domain && r.breadcrumb) {
      const m = String(r.breadcrumb).replace(/^https?:\/\//i, '').split(/[›»>\/\s|]/)[0].trim();
      if (m && m.includes('.')) domain = m.replace(/^www\./, '');
    }

    // Keep `position` as the position within this SERP page. The global
    // organic position is derived separately so page 2 starts at #11,
    // page 3 at #21, etc. (even when a page contains fewer rows).
    const localPosition = Number(r.position) > 0 ? Number(r.position) : (idx + 1);
    results.push({
      position: localPosition,
      type: 'Organic',
      title: r.title || '',
      url,
      domain,
      snippet: r.description || r.snippet || '',
      breadcrumb: r.breadcrumb || '',
      page: pageNum,
      query,
      scrapedAt: r.scrapedAt || new Date().toISOString()
    });
    added++;
  });

  let aioAdded = false;
  const aio = payload.aiOverview;
  if (aio && aio.found) {
    const exists = aioResults.some((a) => a.query === query && a.page === pageNum);
    if (!exists) {
      aioResults.push({
        found: true,
        text: aio.answerText || aio.text || '',
        citations: (aio.citations || []).map((c) => ({
          label: c.label || c.title || '',
          url: c.url || ''
        })),
        query,
        page: pageNum,
        scrapedAt: new Date().toISOString()
      });
      aioAdded = true;
    }
  }

  results.sort((a, b) => (a.query || '').localeCompare(b.query || '') || (a.page || 1) - (b.page || 1) || (a.position || 0) - (b.position || 0));
  // Global organic position must respect the source SERP page. Do not
  // renumber by array index: deduped/removed URLs would otherwise make
  // page 2 show #1..#9 instead of #11..#19.
  results.forEach((r, i) => {
    const pg = Math.max(1, Number(r.page) || 1);
    const local = Math.max(1, Number(r.position) || ((i % 10) + 1));
    r.localPosition = local;
    r.globalPosition = ((pg - 1) * 10) + local;
  });

  await chrome.storage.local.set({
    [RS_SERP_RESULTS_KEY]: results,
    [RS_SERP_PAGES_KEY]: pages,
    [RS_SERP_AIO_KEY]: aioResults
  });

  return {
    added,
    aioAdded,
    total: results.length,
    pages: pages.length,
    aioCount: aioResults.length
  };
}

// Lightweight /goto resolve (optional, non-blocking)
function rsResolveGotoViaTab(gotoUrl) {
  return new Promise((resolve) => {
    let tabId = null;
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 8000);
    function cleanup() {
      clearTimeout(timeout);
      try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch (_) {}
      if (tabId != null) chrome.tabs.remove(tabId).catch(() => {});
    }
    function onUpdated(id, info, tab) {
      if (id !== tabId) return;
      const u = (tab && tab.url) || info.url || '';
      if (!u || u.startsWith('chrome') || rsIsGotoUrl(u) || /google\.[^/]+\/goto/.test(u)) return;
      if (/^https?:\/\//i.test(u)) {
        cleanup();
        resolve(u);
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.create({ url: gotoUrl, active: false }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        cleanup();
        resolve(null);
        return;
      }
      tabId = tab.id;
    });
  });
}

async function rsPatchGotos(map) {
  if (!map || !Object.keys(map).length) return;
  const data = await chrome.storage.local.get([RS_SERP_RESULTS_KEY]);
  let results = data[RS_SERP_RESULTS_KEY] || [];
  let changed = false;
  results = results.map((r) => {
    if (map[r.url]) {
      changed = true;
      const url = map[r.url];
      let domain = r.domain || '';
      try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
      return Object.assign({}, r, { url, domain });
    }
    return r;
  });
  if (changed) await chrome.storage.local.set({ [RS_SERP_RESULTS_KEY]: results });
}

const rsProcessingTabs = new Set();

async function rsDoScrapeAndAdvance(tabId) {
  if (rsProcessingTabs.has(tabId)) return;
  rsProcessingTabs.add(tabId);
  try {
    let state = await rsGetAutoState();
    if (!state || !state.active || state.tabId !== tabId) return;

    // Let SERP settle (same timing as original SERP extension)
    await rsSleep(600 + Math.random() * 500);

    state = await rsGetAutoState();
    if (!state || !state.active) return;

    let payload = null;
    try {
      payload = await rsScrapeTab(tabId);
      console.log('[RS multi] scrape page', state.currentPage, 'count=', payload && payload.count, 'results=', payload && payload.results && payload.results.length);
    } catch (e) {
      console.warn('[RS multi] scrape failed', e);
      state = await rsGetAutoState();
      if (state) await rsFinishAutoScrape(state, 'error');
      return;
    }

    if (payload) {
      const merge = await rsMergePayload(payload);
      console.log('[RS multi] merge', merge);

      // Non-blocking /goto resolve
      const gotoUrls = [...new Set(
        (payload.results || []).filter((r) => rsIsGotoUrl(r.url)).map((r) => r.url)
      )];
      if (gotoUrls.length > 0) {
        (async () => {
          const map = {};
          for (const g of gotoUrls.slice(0, 15)) {
            const real = await rsResolveGotoViaTab(g);
            if (real) map[g] = real;
          }
          await rsPatchGotos(map);
        })().catch(() => {});
      }
    }

    state = await rsGetAutoState();
    if (!state || !state.active) return;

    state.scrapedCount = (state.scrapedCount || 0) + 1;
    state.currentPage = (state.currentPage || 1) + 1;
    await rsSetAutoState(state);

    try {
      chrome.action.setBadgeText({ text: String(state.scrapedCount) });
      chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
    } catch (_) {}

    if (state.currentPage > state.targetPages) {
      await rsFinishAutoScrape(state, 'completed');
      return;
    }

    const nextUrl = rsBuildPageUrl(state.engine, state.baseUrl, state.currentPage);
    try {
      await chrome.tabs.update(tabId, { url: nextUrl });
    } catch (e) {
      console.warn('[RS multi] navigate failed', e);
      state = await rsGetAutoState();
      if (state) await rsFinishAutoScrape(state, 'error');
    }
  } finally {
    rsProcessingTabs.delete(tabId);
  }
}

if (!globalThis.__rsSerpAutoListenerV3) {
  globalThis.__rsSerpAutoListenerV3 = true;
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== 'complete') return;
    rsGetAutoState().then((state) => {
      if (state && state.active && state.tabId === tabId) {
        rsDoScrapeAndAdvance(tabId);
      }
    }).catch(() => {});
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action || !String(msg.action).startsWith('RS_SERP_')) return;

  if (msg.action === 'RS_SERP_SCRAPE_CURRENT') {
    (async () => {
      try {
        const payload = await rsScrapeTab(msg.tabId);
        if (!payload) {
          sendResponse({ ok: false, error: 'Scrape returned empty' });
          return;
        }
        const merge = await rsMergePayload(payload);
        sendResponse({
          ok: true,
          ...merge,
          page: payload.page,
          query: payload.query,
          rawCount: payload.count
        });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }

  if (msg.action === 'RS_SERP_START_AUTO') {
    (async () => {
      try {
        const tab = await chrome.tabs.get(msg.tabId);
        const engine = rsDetectEngine(tab.url || '');
        if (!engine) {
          sendResponse({ ok: false, error: 'Open a Google or Bing search results page first.' });
          return;
        }
        const targetPages = Math.min(20, Math.max(1, parseInt(msg.targetPages, 10) || 10));

        const prev = await rsGetAutoState();
        if (prev && prev.active) {
          await rsFinishAutoScrape(prev, 'stopped');
        }

        if (msg.clearPrevious !== false) {
          await chrome.storage.local.set({
            [RS_SERP_RESULTS_KEY]: [],
            [RS_SERP_PAGES_KEY]: [],
            [RS_SERP_AIO_KEY]: []
          });
        }

        const state = {
          active: true,
          done: false,
          tabId: msg.tabId,
          engine,
          baseUrl: tab.url,
          targetPages,
          currentPage: 1,
          scrapedCount: 0,
          startedAt: new Date().toISOString()
        };
        await rsSetAutoState(state);

        try {
          chrome.action.setBadgeText({ text: '0' });
          chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
        } catch (_) {}

        sendResponse({ ok: true, targetPages, engine });

        // Kick page 1 (don't wait for onUpdated if already on page 1)
        const page1Url = rsBuildPageUrl(engine, tab.url, 1);
        try {
          if (page1Url !== tab.url) {
            await chrome.tabs.update(msg.tabId, { url: page1Url });
          } else {
            // Page already loaded — scrape now
            await rsDoScrapeAndAdvance(msg.tabId);
          }
        } catch (e) {
          console.warn('[RS multi] start kick failed', e);
          const st = await rsGetAutoState();
          if (st && st.active) await rsFinishAutoScrape(st, 'error');
        }
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }

  if (msg.action === 'RS_SERP_STOP_AUTO') {
    (async () => {
      const state = await rsGetAutoState();
      if (state && state.active) await rsFinishAutoScrape(state, 'stopped');
      else if (state) {
        state.active = false;
        state.done = true;
        state.finishReason = 'stopped';
        state.finishedAt = new Date().toISOString();
        await rsSetAutoState(state);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.action === 'RS_SERP_GET_AUTO_STATE') {
    rsGetAutoState()
      .then((state) => sendResponse({ ok: true, state }))
      .catch(() => sendResponse({ ok: false, state: null }));
    return true;
  }

  if (msg.action === 'RS_SERP_GET_MULTI_DATA') {
    (async () => {
      const d = await chrome.storage.local.get([RS_SERP_RESULTS_KEY, RS_SERP_PAGES_KEY, RS_SERP_AIO_KEY]);
      sendResponse({
        ok: true,
        results: d[RS_SERP_RESULTS_KEY] || [],
        pages: d[RS_SERP_PAGES_KEY] || [],
        aioResults: d[RS_SERP_AIO_KEY] || []
      });
    })();
    return true;
  }

  if (msg.action === 'RS_SERP_CLEAR_MULTI') {
    (async () => {
      await chrome.storage.local.set({
        [RS_SERP_RESULTS_KEY]: [],
        [RS_SERP_PAGES_KEY]: [],
        [RS_SERP_AIO_KEY]: []
      });
      const state = await rsGetAutoState();
      if (state && state.active) await rsFinishAutoScrape(state, 'stopped');
      sendResponse({ ok: true });
    })();
    return true;
  }
});


// ─── Niche Check background job (survives popup close) ─────────────
const NICHE_JOB_KEY = 'rs_niche_job';
let _nicheJobAbort = false;
let _discoverJob = null;
let _batchJob = null;
let _batchRunning = false; // { id, status, paused, stop, seed, queries, done, keywordMap serializable, keywords }
let _discoverRunning = false;
let _nicheJobRunning = false;

// Clear any stale messageHandlers locks for niche (from older builds that locked them)
try {
  for (const k of Array.from(messageHandlers.keys())) {
    if (String(k).startsWith('NICHE_JOB_')) messageHandlers.delete(k);
  }
} catch (_) {}

async function nicheJobSet(state) {
  // Dual-write: local survives SW restart; session is fine for same session
  const payload = { [NICHE_JOB_KEY]: state };
  try { await chrome.storage.local.set(payload); } catch (_) {}
  try { await chrome.storage.session.set(payload); } catch (_) {}
}

async function nicheJobGet() {
  // Prefer local (more reliable across service-worker restarts)
  try {
    const s = await chrome.storage.local.get(NICHE_JOB_KEY);
    if (s && s[NICHE_JOB_KEY]) return s[NICHE_JOB_KEY];
  } catch (_) {}
  try {
    const s = await chrome.storage.session.get(NICHE_JOB_KEY);
    if (s && s[NICHE_JOB_KEY]) return s[NICHE_JOB_KEY];
  } catch (_) {}
  return null;
}

function nicheIsHomepage(url) {
  if (!url) return false;
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
    return path === '/' || path === '';
  } catch (_) {
    return false;
  }
}

function nicheFormatAge(createdDate) {
  const created = new Date(createdDate);
  if (isNaN(created.getTime())) return null;
  const ms = Date.now() - created.getTime();
  if (ms < 0) return { ageYears: 0, ageLabel: '0d' };
  const days = Math.floor(ms / (24 * 3600 * 1000));
  const years = ms / (365.25 * 24 * 3600 * 1000);
  const yWhole = Math.floor(years);
  const months = Math.round((years - yWhole) * 12);
  let ageLabel;
  if (days < 30) ageLabel = Math.max(0, days) + 'd';
  else if (yWhole < 1) ageLabel = Math.max(1, months || 1) + 'm';
  else ageLabel = yWhole + 'y' + (months ? ' ' + months + 'm' : '');
  return { ageYears: years, ageLabel };
}

/** Run SERP_FETCH_PAGE as a promise (reuse existing handler internals via message loop is hard — call URL path) */
function nicheFetchSerp(query, gl, hl, near) {
  return new Promise((resolve) => {
    // Direct call pattern: use same logic as handleSERPFetchPage by invoking chrome APIs here
    (async () => {
      let tabId = null;
      try {
        let url = 'https://www.google.com/search'
          + '?q=' + encodeURIComponent(query)
          + '&num=10&start=0'
          + '&hl=' + encodeURIComponent(hl || 'en');
        if (gl) url += '&gl=' + encodeURIComponent(String(gl).toLowerCase());
        if (near) url += '&near=' + encodeURIComponent(near);

        const tab = await chrome.tabs.create({ url, active: false });
        tabId = tab.id;

        const waitTabLoad = (id, ms) => new Promise((res, rej) => {
          const timeout = setTimeout(() => rej(new Error('Tab load timeout')), ms);
          const done = () => {
            clearTimeout(timeout);
            try { chrome.tabs.onUpdated.removeListener(listener); } catch (_) {}
            res();
          };
          const listener = (tid, info) => {
            if (tid === id && info.status === 'complete') done();
          };
          chrome.tabs.onUpdated.addListener(listener);
          chrome.tabs.get(id).then((t) => {
            if (t && t.status === 'complete') done();
          }).catch(() => {});
        });

        try {
          await waitTabLoad(tabId, 35000);
        } catch (loadErr) {
          // One retry on timeout — Google can be slow
          try { await chrome.tabs.remove(tabId); } catch (_) {}
          const tab2 = await chrome.tabs.create({ url, active: false });
          tabId = tab2.id;
          await waitTabLoad(tabId, 35000);
        }

        if (_nicheJobAbort) {
          try { await chrome.tabs.remove(tabId); } catch (_) {}
          resolve({ ok: false, error: 'Stopped', results: [] });
          return;
        }

        await new Promise((r) => setTimeout(r, 2800));

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const out = [];
            const seen = new Set();
            if (document.querySelector('#captcha-form, #recaptcha, form[action*="sorry"], #challenge-form')) {
              return { __captcha: true, items: [], hasAiOverview: false };
            }
            let hasAiOverview = false;
            try {
              hasAiOverview = !!(
                document.querySelector('.ULSxyf .MzVe4d, .hdzaWe, .YzScba, .AIOverview, #eKIzJc') ||
                Array.from(document.querySelectorAll('h1, h2, span, div')).some((el) => {
                  const t = (el.textContent || '').trim().toLowerCase();
                  return t === 'ai overview' || (t.startsWith('ai overview') && t.length < 48);
                })
              );
            } catch (_) {}

            function resolveDestinationUrl(a, container) {
              if (!a) return null;
              let href = a.getAttribute('href') || a.href || '';
              if (href.startsWith('/url?') || href.includes('google.com/url?')) {
                try {
                  const u = href.startsWith('http') ? new URL(href) : new URL(href, 'https://www.google.com');
                  const q = u.searchParams.get('q') || u.searchParams.get('url');
                  if (q && q.startsWith('http')) href = q;
                } catch (e) {}
              }
              if (!href.startsWith('http')) {
                const root = container || a.parentElement;
                if (root) {
                  const cite = root.querySelector('cite');
                  if (cite) {
                    let citeText = (cite.textContent || '').trim().split(/[›>]/)[0].trim();
                    citeText = citeText.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[\s\/]/)[0];
                    if (citeText && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(citeText)) href = 'https://' + citeText;
                  }
                }
              }
              if (!href || !href.startsWith('http')) return null;
              try {
                const host = new URL(href).hostname.toLowerCase();
                if (host.includes('google.') || host.includes('gstatic.')) return null;
              } catch (e) { return null; }
              return href;
            }

            function isAd(el) {
              return !!(el.querySelector('[data-text-ad]') || el.closest('[data-text-ad]') || el.closest('[aria-label="Ads"]'));
            }

            const containers = Array.from(document.querySelectorAll('#rso .g, #search .MjjYud, .tF2Cxc, div.g')).filter(el => {
              const h3 = el.querySelector('h3');
              return h3 && !isAd(el);
            });

            for (const el of containers) {
              const h3 = el.querySelector('h3');
              if (!h3) continue;
              let a = el.querySelector('a[href]');
              if (!a) a = h3.closest('a[href]');
              if (!a) continue;
              const href = resolveDestinationUrl(a, el);
              if (!href) continue;
              let domain = '';
              try { domain = new URL(href).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) {}
              if (!domain || domain.includes('google.') || seen.has(domain)) continue;
              seen.add(domain);
              out.push({
                title: (h3.textContent || '').trim(),
                url: href,
                domain,
                position: out.length + 1
              });
              if (out.length >= 10) break;
            }
            return { items: out, hasAiOverview };
          }
        });

        try { await chrome.tabs.remove(tabId); } catch (_) {}
        tabId = null;

        const payload = results?.[0]?.result;
        if (payload && payload.__captcha) {
          resolve({ ok: false, error: 'Google captcha', results: [], hasAiOverview: false });
        } else {
          const list = Array.isArray(payload) ? payload : (payload?.items || []);
          resolve({
            ok: true,
            results: list.map((r, i) => ({ ...r, position: r.position || i + 1 })),
            hasAiOverview: !!(payload && !Array.isArray(payload) && payload.hasAiOverview)
          });
        }
      } catch (err) {
        if (tabId) try { await chrome.tabs.remove(tabId); } catch (_) {}
        resolve({ ok: false, error: err.message || 'SERP fetch failed', results: [] });
      }
    })();
  });
}

async function nicheEnrich(list, onProgress) {
  const base = (list || []).map((r, i) => ({
    domain: r.domain || '',
    url: r.url || '',
    title: r.title || '',
    serpPosition: r.position || i + 1,
    dr: null,
    da: null,
    spam: null,
    backlinks: null,
    ageYears: null,
    ageLabel: null,
    isHomepage: nicheIsHomepage(r.url)
  }));

  const domains = base.map(b => b.domain).filter(Boolean);

  // MOZ batch
  try {
    const moz = await mozBatchCore(domains);
    const map = (moz && moz.results) || {};
    base.forEach((row) => {
      const key = String(row.domain || '').replace(/^www\./, '').toLowerCase();
      const m = map[key] || map[row.domain];
      if (!m) return;
      if (typeof m.domainAuthority === 'number') row.da = Math.round(m.domainAuthority);
      if (typeof m.spamScore === 'number' && m.spamScore >= 0) row.spam = Math.round(m.spamScore);
      if (typeof m.backlinks === 'number' && m.backlinks > 0) row.backlinks = m.backlinks;
    });
  } catch (_) {}

  if (_nicheJobAbort) return base;

  for (let i = 0; i < base.length; i++) {
    if (_nicheJobAbort) break;
    const row = base[i];
    if (!row.domain) continue;
    if (row.da == null || row.spam == null) {
      try {
        const m = await mozLimit(() => mozFetchCore(row.domain));
        if (m && m.ok) {
          if (typeof m.domainAuthority === 'number') row.da = Math.round(m.domainAuthority);
          if (typeof m.spamScore === 'number' && m.spamScore >= 0) row.spam = Math.round(m.spamScore);
        }
      } catch (_) {}
    }
    try {
      const dr = await ahrefsLimit(() => ahrefsDrCore(row.domain));
      if (dr && dr.domainRating != null) row.dr = dr.domainRating;
    } catch (_) {}
    try {
      const rd = await rdapLimit(() => rdapCore(row.domain));
      if (rd && rd.ok && rd.createdDate) {
        const age = nicheFormatAge(rd.createdDate);
        if (age) {
          row.ageYears = age.ageYears;
          row.ageLabel = age.ageLabel;
        }
      }
    } catch (_) {}
    if (onProgress) onProgress(i + 1, base.length);
    await new Promise(r => setTimeout(r, 200));
  }
  return base;
}

async function nicheRunSingle(seed, gl, hl, near, jobId) {
  await nicheJobSet({
    id: jobId, mode: 'single', status: 'running', phase: 'serp',
    seed, gl, hl, progress: 5, message: 'Fetching Google Top 10…',
    result: null, multiRows: null, error: null, stopped: false
  });

  if (_nicheJobAbort) {
    await nicheJobSet({ id: jobId, status: 'stopped', message: 'Stopped', stopped: true });
    return;
  }

  const serp = await nicheFetchSerp(seed, gl, hl, near);
  if (_nicheJobAbort) {
    await nicheJobSet({ id: jobId, status: 'stopped', message: 'Stopped', stopped: true });
    return;
  }
  if (!serp.ok || !(serp.results || []).length) {
    await nicheJobSet({
      id: jobId, status: 'error', mode: 'single', seed, gl, hl,
      error: (serp && serp.error) || 'No organic results',
      message: (serp && serp.error) || 'No organic results'
    });
    return;
  }

  await nicheJobSet({
    id: jobId, mode: 'single', status: 'running', phase: 'metrics',
    seed, gl, hl, progress: 25, message: 'Loading DR / DA / Age…', result: null
  });

  const competitors = await nicheEnrich(serp.results, async (i, n) => {
    if (_nicheJobAbort) return;
    await nicheJobSet({
      id: jobId, mode: 'single', status: 'running', phase: 'metrics',
      seed, gl, hl, progress: 25 + Math.round((i / n) * 70),
      message: 'Metrics ' + i + '/' + n + '…'
    });
  });

  if (_nicheJobAbort) {
    await nicheJobSet({ id: jobId, status: 'stopped', message: 'Stopped', stopped: true, seed, gl, hl });
    return;
  }

  const RS = (typeof RSNiche !== 'undefined') ? RSNiche : (typeof self !== 'undefined' && self.RSNiche);
  if (!RS || !RS.computeOpportunity) {
    await nicheJobSet({ id: jobId, status: 'error', error: 'Niche engine missing', message: 'Niche engine missing' });
    return;
  }

  // Same volume path as SERP sidebar / search-box VOL pill (KW_OVERVIEW → KE key)
  let volume = null;
  let volumeConfirmed = false;
  let volumeSource = null;
  try {
    await nicheJobSet({
      id: jobId, mode: 'single', status: 'running', phase: 'volume',
      seed, gl, hl, progress: 92, message: 'Fetching search volume…'
    });
    const country = String(gl || 'us').toLowerCase().replace(/[^a-z]/g, '').slice(0, 5) || 'us';
    const cfg = await getVolumeApiConfig();
    const ck = 'kw_' + country + '_' + String(seed).toLowerCase().replace(/\s+/g, '_').slice(0, 55);

    // Prefer cache (SERP may already have fetched KE volume for this keyword)
    let volRes = null;
    try {
      const cached = await getCachedData(ck);
      if (cached && cached.ok && typeof cached.volume === 'number') {
        const src = String(cached.source || '');
        // Prefer KE when niche/SERP volume is enabled; otherwise accept any cached volume
        if (cfg.keApiKeyVolume) {
          if (src === 'Keywords Everywhere') volRes = cached;
        } else {
          volRes = cached;
        }
      }
    } catch (_) {}

    // Same as SERP KW_OVERVIEW: KE key when volume OR niche-volume toggle is on
    const volKey = cfg.keApiKeyVolume || ((cfg.useNicheVolume || cfg.useVolume) && cfg.keApiKey) || '';
    if (!volRes && volKey) {
      try {
        const ke = await fetchKeywordsEverywhereVolume(seed, volKey, country);
        if (ke && ke.ok) {
          await setCachedData(ck, ke, CONFIG.KW_CACHE_TTL);
          volRes = ke;
        }
      } catch (e) {
        console.warn('[Niche] KE volume failed', e);
      }
    }

    // Free fallbacks (same as KW_OVERVIEW) when no KE volume — SBMM first
    if (!volRes) {
      try {
        const sb = await fetchSbmmKeyword(seed, country);
        if (sb && sb.ok && typeof sb.volume === 'number') {
          await setCachedData(ck, sb, CONFIG.KW_CACHE_TTL);
          volRes = sb;
        }
      } catch (_) {}
    }
    if (!volRes) {
      try {
        const kra = await kwResearchCore(seed);
        if (kra && kra.ok && kra.volume > 0) {
          await setCachedData(ck, kra, CONFIG.KW_CACHE_TTL);
          volRes = kra;
        }
      } catch (_) {}
    }
    // Accept any cached volume if still empty (e.g. free cache while KE was preferred)
    if (!volRes) {
      try {
        const cached2 = await getCachedData(ck);
        if (cached2 && cached2.ok && typeof cached2.volume === 'number') {
          volRes = cached2;
        }
      } catch (_) {}
    }

    if (volRes && volRes.ok && typeof volRes.volume === 'number' && volRes.volume >= 0) {
      volume = volRes.volume;
      volumeConfirmed = volRes.estimated !== true;
      volumeSource = volRes.source || 'Keywords Everywhere';
    }
  } catch (e) {
    console.warn('[Niche] volume fetch error', e);
  }

  const verdict = RS.computeOpportunity({
    seed,
    competitors,
    volume,
    volumeConfirmed,
    hasAiOverview: serp.hasAiOverview
  });

  const payload = {
    seed, gl, hl, near: near || '',
    competitors, verdict,
    hasAiOverview: serp.hasAiOverview,
    volume,
    volumeConfirmed,
    volumeSource
  };

  await nicheJobSet({
    id: jobId, mode: 'single', status: 'done', phase: 'done',
    seed, gl, hl, progress: 100,
    message: 'Done · “' + seed + '” · ' + (gl || 'us').toUpperCase()
      + (typeof volume === 'number' ? ' · vol ' + (volume >= 1000 ? Math.round(volume / 1000) + 'K' : volume) : ''),
    result: payload, error: null, stopped: false
  });
}

/** Per-country volume — same sources as SERP KW_OVERVIEW / single niche (KE → free). */
async function nicheFetchVolumeForCountry(seed, country) {
  const gl = String(country || 'us').toLowerCase().replace(/[^a-z]/g, '').slice(0, 5) || 'us';
  let volume = null;
  let volumeConfirmed = false;
  let volumeSource = null;
  try {
    const cfg = await getVolumeApiConfig();
    const ck = 'kw_' + gl + '_' + String(seed).toLowerCase().replace(/\s+/g, '_').slice(0, 55);
    let volRes = null;
    try {
      const cached = await getCachedData(ck);
      if (cached && cached.ok && typeof cached.volume === 'number') {
        const src = String(cached.source || '');
        if (cfg.keApiKeyVolume || cfg.useNicheVolume || cfg.useVolume) {
          if (src === 'Keywords Everywhere') volRes = cached;
        } else {
          volRes = cached;
        }
      }
    } catch (_) {}
    const volKey = cfg.keApiKeyVolume || ((cfg.useNicheVolume || cfg.useVolume) && cfg.keApiKey) || '';
    if (!volRes && volKey) {
      try {
        const ke = await fetchKeywordsEverywhereVolume(seed, volKey, gl);
        if (ke && ke.ok) {
          await setCachedData(ck, ke, CONFIG.KW_CACHE_TTL);
          volRes = ke;
        }
      } catch (_) {}
    }
    if (!volRes) {
      try {
        const sb = await fetchSbmmKeyword(seed, gl);
        if (sb && sb.ok && typeof sb.volume === 'number') {
          await setCachedData(ck, sb, CONFIG.KW_CACHE_TTL);
          volRes = sb;
        }
      } catch (_) {}
    }
    if (!volRes) {
      try {
        const kra = await kwResearchCore(seed);
        if (kra && kra.ok && kra.volume > 0) {
          await setCachedData(ck, kra, CONFIG.KW_CACHE_TTL);
          volRes = kra;
        }
      } catch (_) {}
    }
    if (!volRes) {
      try {
        const cached2 = await getCachedData(ck);
        if (cached2 && cached2.ok && typeof cached2.volume === 'number') {
          volRes = cached2;
        }
      } catch (_) {}
    }
    if (volRes && volRes.ok && typeof volRes.volume === 'number' && volRes.volume >= 0) {
      volume = volRes.volume;
      volumeConfirmed = volRes.estimated !== true;
      volumeSource = volRes.source || 'Keyword Planner';
    }
  } catch (_) {}
  return { volume, volumeConfirmed, volumeSource };
}

async function nicheRunMulti(seed, markets, jobId) {
  const total = markets.length;
  const rows = [];
  await nicheJobSet({
    id: jobId, mode: 'multi', status: 'running', phase: 'scan',
    seed, progress: 0, message: 'Scanning markets…', multiRows: [], error: null
  });

  for (let i = 0; i < total; i++) {
    if (_nicheJobAbort) break;
    const [gl, hl] = markets[i];
    await nicheJobSet({
      id: jobId, mode: 'multi', status: 'running', phase: 'scan',
      seed, progress: Math.round((i / total) * 100),
      message: '“' + seed + '” · market ' + (i + 1) + '/' + total + ' · ' + String(gl).toUpperCase(),
      multiRows: rows.slice()
    });

    try {
      const serp = await nicheFetchSerp(seed, gl, hl, '');
      if (_nicheJobAbort) break;
      if (!serp.ok || !(serp.results || []).length) {
        rows.push({ gl, hl, error: (serp && serp.error) || 'Empty SERP' });
      } else {
        const competitors = await nicheEnrich(serp.results, null);
        if (_nicheJobAbort) break;
        // Per-country volume (KE uses country code — US 550K vs MA 16.6M)
        const volInfo = await nicheFetchVolumeForCountry(seed, gl);
        const RS = (typeof RSNiche !== 'undefined') ? RSNiche : (typeof self !== 'undefined' && self.RSNiche);
        const verdict = RS && RS.computeOpportunity
          ? RS.computeOpportunity({
              seed,
              competitors,
              volume: volInfo.volume,
              volumeConfirmed: volInfo.volumeConfirmed,
              hasAiOverview: serp.hasAiOverview
            })
          : null;
        rows.push({
          gl, hl,
          scoreNum: verdict && verdict.scoreNum,
          lowAuth: verdict && verdict.lowAuth,
          midAuth: verdict && verdict.midAuth,
          highAuth: verdict && verdict.highAuth,
          homepageCount: verdict && verdict.homepageCount,
          lowAge: verdict && verdict.lowAge,
          lowSpam: verdict && verdict.lowSpam,
          verdict: verdict && verdict.verdict,
          verdictLabel: verdict && verdict.verdictLabel,
          nicheTypeLabel: verdict && verdict.nicheTypeLabel,
          hasAiOverview: serp.hasAiOverview,
          volume: volInfo.volume,
          volumeConfirmed: volInfo.volumeConfirmed,
          volumeSource: volInfo.volumeSource,
          topDomain: competitors[0] && competitors[0].domain,
          topDr: competitors[0] && competitors[0].dr,
          payload: {
            seed, gl, hl, near: '', competitors, verdict,
            hasAiOverview: serp.hasAiOverview,
            volume: volInfo.volume,
            volumeConfirmed: volInfo.volumeConfirmed,
            volumeSource: volInfo.volumeSource
          }
        });
      }
    } catch (e) {
      rows.push({ gl, hl, error: e.message || String(e) });
    }

    await nicheJobSet({
      id: jobId, mode: 'multi', status: 'running',
      seed, progress: Math.round(((i + 1) / total) * 100),
      message: 'Market ' + (i + 1) + '/' + total + ' done',
      multiRows: rows.slice()
    });

    if (i < total - 1 && !_nicheJobAbort) {
      await new Promise(r => setTimeout(r, 1400 + Math.random() * 800));
    }
  }

  if (_nicheJobAbort) {
    await nicheJobSet({
      id: jobId, mode: 'multi', status: 'stopped', seed,
      message: 'Stopped', multiRows: rows, stopped: true
    });
  } else {
    await nicheJobSet({
      id: jobId, mode: 'multi', status: 'done', seed, progress: 100,
      message: 'Done · ' + rows.filter(r => !r.error).length + '/' + total + ' markets',
      multiRows: rows, stopped: false
    });
  }
}

// Message handlers — register early via existing onMessage if present; append listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;

  if (msg.action === 'NICHE_JOB_START') {
    if (_nicheJobRunning) {
      sendResponse({ ok: false, error: 'Job already running' });
      return true;
    }
    _nicheJobAbort = false;
    _nicheJobRunning = true;
    const jobId = 'nj_' + Date.now();
    const seed = String(msg.seed || '').trim();
    const mode = msg.mode === 'multi' ? 'multi' : 'single';
    if (!seed) {
      _nicheJobRunning = false;
      sendResponse({ ok: false, error: 'Empty keyword' });
      return true;
    }
    sendResponse({ ok: true, jobId });

    (async () => {
      try {
        if (mode === 'multi') {
          const markets = Array.isArray(msg.markets) && msg.markets.length
            ? msg.markets
            : [
                ['us','en'],['uk','en'],['ca','en'],['au','en'],
                ['in','en'],['ae','en'],['sa','ar'],['pk','en'],
                ['bd','en'],['ng','en'],['ph','en'],['id','id']
              ];
          await nicheRunMulti(seed, markets, jobId);
        } else {
          await nicheRunSingle(seed, msg.gl || 'us', msg.hl || 'en', msg.near || '', jobId);
        }
      } catch (e) {
        await nicheJobSet({
          id: jobId, status: 'error', seed,
          error: e.message || String(e), message: e.message || String(e)
        });
      } finally {
        _nicheJobRunning = false;
        _nicheJobAbort = false;
      }
    })();
    return true;
  }

  if (msg.action === 'NICHE_JOB_STATUS') {
    nicheJobGet().then((job) => {
      sendResponse({ ok: true, job: job || null, running: _nicheJobRunning });
    }).catch(() => sendResponse({ ok: true, job: null, running: _nicheJobRunning }));
    return true;
  }

  if (msg.action === 'NICHE_JOB_STOP') {
    _nicheJobAbort = true;
    nicheJobGet().then(async (job) => {
      if (job && job.status === 'running') {
        await nicheJobSet(Object.assign({}, job, {
          status: 'stopped', message: 'Stopping…', stopped: true
        }));
      }
      sendResponse({ ok: true });
    }).catch(() => sendResponse({ ok: true }));
    return true;
  }
});

console.log('[RP] Advanced SERP multi-page auto-scrape v3 (SERP content.js port) loaded');

/* ────────────────────────────────────────────────────────────────────────
 * Search Console Regex: "Apply in GSC" trusted-click helper
 *
 * Search Console's "Custom (regex)" match-type dropdown OPTION only
 * registers a selection on a browser-trusted click; no JS-dispatched event
 * (plain click, keyboard activation, coordinate-accurate pointer events)
 * works. So the gsc-filter.js content script asks this background worker to
 * dispatch a real mouse click at the option's coordinates via the chrome
 * .debugger protocol. The debugger attaches for ~1 second and detaches
 * immediately after. If attaching fails (e.g. DevTools already open on the
 * tab), failure is reported and the content script falls back to asking the
 * user to click the option once themselves.
 *
 * Namespaced under the SCQT_ prefix and handled in its own listener so it
 * never interacts with the action-based message handlers above.
 * ──────────────────────────────────────────────────────────────────────── */
(function () {
  const DEBUGGER_PROTOCOL_VERSION = '1.3';

  async function gscTrustedClick(tabId, x, y) {
    const target = { tabId };
    try {
      await chrome.debugger.attach(target, DEBUGGER_PROTOCOL_VERSION);
    } catch (err) {
      return { ok: false, error: 'debugger-attach-failed: ' + err.message };
    }
    try {
      const params = { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 };
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', params);
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { ...params, type: 'mouseReleased' });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'dispatch-failed: ' + err.message };
    } finally {
      try { await chrome.debugger.detach(target); } catch { /* already detached */ }
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || message.type !== 'SCQT_TRUSTED_CLICK') return false;
    const tabId = sender && sender.tab && sender.tab.id;
    if (!tabId) { sendResponse({ ok: false, error: 'no-tab' }); return false; }
    gscTrustedClick(tabId, message.x, message.y).then(sendResponse);
    return true; // keep the message channel open for the async response
  });

  // Keyboard shortcut: toggle URL blurring on Search Console pages (privacy for screen recordings).
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-gsc-url-blur') return;
    const stored = await chrome.storage.local.get('scqt:settings');
    const s = stored['scqt:settings'] || {};
    const next = { ...s, blurUrls: !s.blurUrls };
    await chrome.storage.local.set({ 'scqt:settings': next });
    const tabs = await chrome.tabs.query({ url: 'https://search.google.com/search-console/*' });
    for (const t of tabs) {
      try {
        await chrome.tabs.sendMessage(t.id, { type: 'SCQT_BLUR_STATE', blurUrls: next.blurUrls, blurQueries: next.blurQueries });
      } catch { /* content script not ready on this tab; storage listener covers it */ }
    }
  });
})();
