# Shahzaib SEO: API and metric mechanism audit

This is a source-code audit of the supplied extension and this derivative, not a live certification of provider access, pricing, data accuracy, or every feature. No stored user keys were accessed or used for this audit. Provider labels and comments are implementation claims, not proof that an endpoint currently works or permits third-party use.

## How the extension works

1. `manifest.json` injects `content/content.js` and feature-specific scripts into matching web pages. They inspect the rendered DOM: headings, metadata, links, images, schema, text, technologies and page signals.
2. The popup requests page analysis, then separately sends actions such as `MOZ_FETCH`, `AHREFS_DR_FETCH`, `TRAFFIC_FETCH` and `RDAP_LOOKUP` through `chrome.runtime.sendMessage`.
3. `background/background.js` handles cross-origin requests, provider keys, timeouts, retries, domain normalization and caching. It returns normalized objects to the popup, SERP sidebar or overlay.
4. Popup renderers format the results. A number displayed as zero, an estimate, or an unavailable value can therefore originate from normalization or rendering, rather than from a provider's actual measurement.
5. The extension does not have its own Moz/Ahrefs backlink index. Changing the developer website does not transfer any external API to shazzseo.com.

## DA, PA and Spam Score

Implementation: `getMozApiKey`, `keDomainLinkMetrics`, `mozRowToResult`, `mozFetchCore`, `mozBatchCore` in `background/background.js`; `renderMozMetrics` in `popup/popup.js`.

Primary request:

- POST `https://linkmetrics.keywordseverywhere.com/service/get-domain-link-metrics`
- Fallback: POST `https://data.keywordseverywhere.com/service/get-domain-link-metrics`
- Headers: `Accept: application/x.seometrics.v4+json`, `Content-Type: text/plain;charset=UTF-8`.
- JSON body: `domains`, `country: "us"`, `version: "11.55"`, `num: 5000`, and `api_key`.
- Key comes from `chrome.storage.sync.keApiKey`; `keEnabled === false` empties it. The implementation tries the saved key and then an empty key. An empty-key attempt is not evidence of guaranteed free access.
- A usable row must contain `moz_domain_authority`. A successful endpoint is preferred on later calls. HTTP/network failures can trigger a 20-second cooldown.

| Display | Upstream field and transformation |
| --- | --- |
| DA | Rounded `moz_domain_authority` |
| PA | Rounded `moz_page_authority`; falls back to DA when absent |
| Spam Score | `Math.max(0, Math.round(Number(moz_spam_score) || 0))` |
| Referring domains | `moz_root_domains_to_subdomain`, otherwise zero |
| Backlinks | `moz_external_pages_to_subdomain`, otherwise zero; this is a linking-page count, not necessarily a count of individual links |
| Historical DA | `moz_da_history_values`, parsed from an array or pipe-delimited string |
| PageRank Score | Provider field `page_rank`; the code does not establish this as Google's current internal PageRank |
| Link Propensity | Rounded `moz_link_propensity` |

DA/PA/Spam are third-party metrics, not Google ranking scores. The extension receives the numbers; the provider's proprietary computation cannot be reconstructed from this client.

If Keywords Everywhere fails, `semrushBacklinksFallback` requests `https://bl.publicapi.semrush.com/?url=...&ref=sq` and parses XML. It returns DA, PA and Spam as null, so those should display unavailable. It uses `links_hostname` or `links` for backlinks. If `domains_hostname` is absent or zero, it substitutes `Math.max(1, Math.round(backlinks * 0.15))`: **this fallback referring-domain count is a heuristic, not measured data**. A separate `SEMRUSH_BACKLINKS_FETCH` action uses different parsing and zero defaults, so different panels can disagree.

### Confirmed data-quality issues in the existing code

- An absent or invalid Moz Spam Score becomes **0%**, which can imply a clean site without supporting data.
- Missing PA is replaced with DA, despite PA and DA being different metrics.
- Missing link counts can become zero rather than unknown.
- The dashboard only accepts DA/PA greater than zero as available, while the detailed renderer accepts non-null values. Genuine zero values can appear differently between panels.
- A single-domain KE lookup can use the first returned row if it cannot find an exact domain match. Unexpected responses could therefore be attributed to the wrong domain.
- Historical DA arrays do not establish month labels by themselves. Local DA/DR history is a history of saved observations, not a newly queried historical index.

These metric behaviors are documented here and were not silently changed as part of the contact update.

## DR (Ahrefs Domain Rating)

Implementation: `getAhrefsApiKey`, `ahrefsDrCore` in `background/background.js`; `AHREFS_DR_FETCH` consumer in `popup/popup.js`.

- GET `https://api.ahrefs.com/v3/public/domain-rating-free?target=...&output=json`.
- `Authorization: Bearer <your Ahrefs key>` from `chrome.storage.sync.ahrefsApiKey`.
- Tries the root domain, `https://domain/`, and `https://www.domain/` as target forms.
- Accepts `domain_rating.domain_rating`, `domain_rating`, or `domainRating` response shapes. Rounds the result to one decimal; the dashboard then rounds to a whole number.
- Up to four retry rounds with backoff; 401/403 become key-required failures; 429 can be retried. Each request has a 12-second timeout.
- No key now returns `needKey: true`. The original shared embedded Ahrefs key has been removed.
- Successful DR results are cached for 24 hours. Cached values can temporarily remain visible after a key is removed.

DR is Ahrefs' metric. It is not computed by this extension and is not interchangeable with Moz DA.

## Other metrics and features

| Feature | Data source / mechanism | Important limits |
| --- | --- | --- |
| Monthly traffic, engagement, geography, channels | With traffic key/feature enabled, KE POST `/service/get-domain-metrics`; otherwise SimilarWeb GET `https://data.similarweb.com/api/v1/data?domain=...`; then SEMrush GET `https://seoquake.publicapi.semrush.com/info.php?url=...` | Estimated data. SimilarWeb visits, KE estimated organic traffic and SEMrush organic traffic are not equivalent measures, although they share a `visits` display field. SimilarWeb can block requests. |
| Organic keywords, backlinks, referring domains | SEMrush public XML endpoints and KE/Moz fields | Separate panels use different sources; absent XML fields may become zero. |
| Keyword volume, CPC, competition and trend | `KW_OVERVIEW`: enabled paid KE volume first; then `https://edu.sbmm.com.pk/api/extension/keyword`; `https://api.keywordresearchapp.com/v1/keywords`; `https://insight.gotrends.app/kw/gethistorymetric` | Provider-dependent estimates. Country handling differs; fallback GoTrends can retry worldwide. No guarantee these services remain free. |
| Anonymous keyword requests | SBMM installation UUID headers; KeywordResearchApp anonymous client ID and `/v1/keywords/track` | Persistent identifiers and searched keywords are sent to those external services. |
| Keyword ideas | Google Suggest `https://suggestqueries.google.com/complete/search`, Google Trends requests, bundled niche library and SERP parsing | Suggestions are not verified search volume or keyword difficulty. |
| Domain registration and age | Per-registry RDAP, `rdap.org`, IANA registry metadata; WHOIS relays `who-dat.as93.net`, `api.whois.vu`, ZA WHOIS; Wayback CDX fallback | Archive first-seen date is not necessarily registration date. Hidden/missing records and limited public-suffix handling can affect results. |
| PageSpeed / Core Web Vitals panels | Google PageSpeed v5 `https://www.googleapis.com/pagespeedonline/v5/runPagespeed`, mobile and desktop | Field data and Lighthouse lab results differ. The embedded PageSpeed key was removed; configure your own key. Some page-derived speed measurements also exist. |
| SEO score | Local `calculateOverallScore` in `content/content.js` | Starts at 100; subtracts penalties for title, description, headings, alt text, viewport, canonical, language, social tags, schema, content and links; adds some bonuses and clamps. It is the extension's rule-based score, not Google's score. |
| GEO score | Local DOM signals in `content/content.js` | Sum of citability (20), E-E-A-T signals (20), structured data (20), AI accessibility (10), multimodal content (10); scaled from 80 to 100. A heuristic, not proof of AI visibility. |
| E-E-A-T, CRO, readability, local-business checks | Local text/DOM rules and formulas | These are implementation heuristics; not official search-engine judgments. |
| Entities / NLP | POST `https://api.textrazor.com/` with configured key | Content is transmitted to TextRazor. |
| DNS, certificates, geolocation, HTTP headers | `dns.google/resolve`, `crt.sh`, `http://ip-api.com/json/` with `ipwhois.app` fallback, `api.hackertarget.com/httpheaders` | Public-service quotas and freshness vary. The first IP geolocation request is HTTP, not HTTPS. |
| Robots, sitemap, llms.txt, links, redirects, source inspection | Direct requests to the inspected website plus DOM inspection | Permissions, server policy, authentication, redirects and network failures affect coverage. |
| Historical snapshots | Wayback `web.archive.org` CDX and `archive.org` availability | Snapshot coverage is incomplete. |
| Google rank / SERP / local pack | Direct search parsing and browser-tab workflows; optional `https://serpapi.com/search.json`, `https://google.serper.dev/search` and `/places`; geocoding via `nominatim.openstreetmap.org` | Geography, personalization, CAPTCHAs and provider quotas affect rank. A scrape is a point-in-time observation. |
| AI briefs, schema suggestions, chat, analysis | Configured Groq, NVIDIA NIM, OpenRouter; some tools use additional AI providers | Requires the selected provider and key. Model output is generated advice, not measured SEO data. Page content or summaries can leave the browser. |
| AI-engine citation / ranking checker | `libs/ranking-checker.js`: provider API calls when configured; otherwise NVIDIA/OpenRouter predictions | **Predictions are not observed rankings or citations.** Even an API response is not a verified reproduction of the provider's consumer search UI. Several engines always use prediction paths. |
| Crawling and web search | `api.firecrawl.dev/v2` with some `/v1` fallback calls | Keyless branches exist, but availability and higher limits depend on provider policy. |
| Automation / agent tools | `api.monid.ai/v1` discovery, inspect, run and polling; user-configured WordPress MCP bridge | External execution/service dependencies. Original WordPress plugin URLs remain technical download dependencies, not Shahzaib SEO contacts. |
| GSC blur / filters / regex tools | Content scripts operating in the user's Search Console page, bundled presets and storage | Not a replacement for a Search Console data API or authorization. |
| CSV / XLSX / PDF exports | Local generation from collected results (`xlsx.full.min.js`, PDF and ZIP helpers) | Exporting a value does not validate its accuracy or source. |

AI provider request URLs include `api.groq.com/openai/v1/chat/completions`, `integrate.api.nvidia.com/v1/chat/completions`, `openrouter.ai/api/v1/chat/completions`, `api.perplexity.ai/chat/completions`, `api.openai.com/v1/chat/completions`, `api.anthropic.com/v1/messages`, `generativelanguage.googleapis.com` and `api.x.ai/v1/chat/completions`. These are source-observed integrations, not a claim that all selected models/routes are current or operational.

## Caching, storage and privacy

- General volatile cache: 5 minutes. DA/DR and many domain/paid metrics: 24 hours. Keyword volume: 7 days. Technical persistent cache: 24 hours. SEMrush traffic's direct success path uses 5 minutes.
- `chrome.storage.local` stores cached objects with `timestamp` and `ttl`. Expiry means the next lookup refetches; it does not guarantee deletion immediately at expiry.
- Concurrent requests with the same key share an in-flight Promise to reduce duplicates. Batch DA and traffic calls reduce network requests.
- Keys use both Chrome sync and local storage depending on provider. They are not a server-side vault; Chrome sync storage can synchronize according to browser settings.
- External providers receive relevant domains, URLs, queries, content and authentication. Broad host access does not make analysis fully local.
- `manifest.json` host permissions show where calls are permitted, not which calls actually ran. The broad HTTP/HTTPS patterns allow additional hosts beyond individually listed domains.
- `debugger`, scripting, tabs, downloads and other permissions are inherited. They deserve a separate least-permission review before store publication.

## Changes made in this update

Developer contacts now show Shahzaib Hassan, https://shazzseo.com and info@shazzseo.com. WhatsApp and the separate original extension-page contact were removed. Original-source provenance remains in README rather than the developer contact section. Embedded Ahrefs/PageSpeed defaults were removed; Groq's embedded credential was already removed. Users supply their own provider credentials through Settings. No provider accounts, billing, endpoints or data rights were transferred or created.

## Recommended next work

1. Preserve missing values as null, label estimated referring domains, and stop substituting DA for PA.
2. Display source, timestamp, target domain, country and measurement type next to each metric.
3. Separate organic-traffic estimates from total visits and prediction results from observed citations.
4. Use supported provider integrations with your own account/key and confirm provider terms, quotas and costs.
5. Run browser-based, credentialed checks with authorized test inputs. This audit did not send paid API requests or certify live responses.
