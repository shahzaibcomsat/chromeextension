# Shahzaib SEO — independent implementation

A new Manifest V3 extension written for Shahzaib Hassan. This release uses newly authored JavaScript, HTML, CSS, SVG artwork and PNG icons. It does not import files, libraries, icons, fingerprints, datasets or credentials from the previously supplied extension. The packaged MIT-licensed tldts library provides public-suffix-aware domain parsing. There are no remote fonts or analytics. See vendor/TLDTS-LICENSE.txt; npm package versions and integrity are recorded in package-lock.json.

This is an independent implementation, not a claim of strict clean-room development: the earlier extension was inspected before this project began. Newly written code alone does not guarantee freedom from all copyright, trademark, patent, API-licensing or Chrome Web Store concerns. Review your branding, provider contracts and publication disclosures before distribution.

## Install locally

1. Download and extract this branch's ZIP.
2. Open `chrome://extensions` in Chrome 116 or later.
3. Enable Developer mode and choose **Load unpacked**.
4. Select the extracted folder containing `manifest.json`.
5. Open an ordinary HTTP/HTTPS page, open Shahzaib SEO, and click **Audit page**.

Use a different folder from the earlier renamed build. Remove that older copy if you no longer need it. This build has its own `1.0.0` version and different source structure. No server, npm installation or compilation is needed to load the packaged extension. The domain parser is included in vendor/.

## Working local features

- Title, description, canonical, language, viewport and robots meta inspection.
- Weighted on-page checklist with individual findings and advice.
- A separately labelled content-discoverability checklist; not an AI-ranking claim.
- Heading outline and skipped-level detection.
- Word counts, approximate English readability, reading time and word frequency.
- Missing versus empty image alt attributes, lazy loading and dimensions.
- Internal/external link inspection, filters, anchors and rel attributes.
- JSON-LD parsing, type extraction and a starter WebPage/Article/Organization generator.
- Social metadata, mixed-content URLs, insecure forms and basic technology signals.
- Browser navigation timings, explicitly distinct from Core Web Vitals.
- Summary audit history (latest 50), deletion controls, JSON and CSV downloads, printable HTML report for browser Save as PDF.
- Isolated, time-limited regular-expression workbench.

## Optional network features

Every feature runs only on an explicit user action. Host access is requested when needed and can be revoked in Integrations.

- Current website: selected response headers, robots.txt, conventional sitemap.xml and llms.txt. Redirects fail rather than silently contacting another host.
- Google Public DNS: A, AAAA, MX, NS and TXT records.
- RDAP registration lookup using direct known registries and rdap.org bootstrap for other TLDs. tldts resolves the registered domain from subdomains and regional suffixes. Coverage depends on the registry; missing registration dates remain unknown.
- Google PageSpeed Insights: your own key, mobile/desktop Lighthouse result and field-data category.
- Serper: your own key, top-ten organic results, related questions/searches, target-domain position if present, and local search observations (latest 50).
- Licensed metrics backend: your own service returning DA/PA/DR/Spam/link/traffic metrics under the contract below.
- Licensed keyword backend: your own service returning keyword metrics under the contract below.
- OpenAI-compatible AI endpoint: your own key/model, explicit summary sharing for content briefs, titles/descriptions, FAQ suggestions and audit plans.

No live credentialed provider test was performed. Integrations are implemented and covered by mocked boundary checks; account entitlements, endpoint availability, model support, costs and provider licensing remain your responsibility. This package does not include a metrics backend or API credits.

### Authority / traffic backend contract

Configure an HTTPS URL in Integrations. The extension POSTs:

```json
{"hostname":"example.com"}
```

If configured, `Authorization: Bearer <your backend token>` is included. The backend must return an exact matching hostname and a nonempty source. Scores must be finite numbers in 0–100. Counts must be finite and nonnegative. Missing metrics remain null; zero is preserved.

```json
{
  "hostname":"example.com",
  "source":"Your licensed provider",
  "observedAt":"2026-10-23T00:00:00Z",
  "da":null,"pa":null,"dr":null,"spam":null,
  "backlinks":null,"referringDomains":null,
  "organicTraffic":null,"monthlyVisits":null
}
```

Source, observed time and fetch time are displayed. DA is never substituted for PA. Referring domains are never estimated from backlinks. Monthly visits and organic traffic are separate.

### Keyword backend contract

Configure a separate HTTPS keyword endpoint. The optional metrics backend token is reused. Request:

```json
{"query":"technical SEO","country":"pk"}
```

Response:

```json
{"query":"technical SEO","country":"pk","source":"Your licensed provider","observedAt":"2026-10-23T00:00:00Z","volume":null,"cpc":null,"currency":"USD","competition":null}
```

Return metrics only when your provider measured/supplied them. Explain your competition scale in your backend's documentation; the extension does not reinterpret it.

## Current boundaries

This is a functional first release, not full feature parity with the reference product. It does not include automated long-running rank monitoring, verified AI-search citations, full-site crawling, broken-link network checks, redirect-chain analysis, Search Console account automation, WordPress publishing, browser debugger automation, competitor datasets, historical provider databases, XLSX export or a native PDF engine. The printable report uses the browser's PDF workflow. No official rich-result validator or exhaustive technology fingerprint collection is included. The bundled public-suffix snapshot requires periodic tldts updates.

These features require additional implementation, provider contracts and/or account access. They are not represented as working controls with invented results.

## Development and verification

Use the existing checkout; there is no reason to create a Git worktree for routine cloud tasks.

```sh
npm run check
npm test
```

Browser harness (requires Python Playwright and Chromium, already provided in this workspace):

```sh
python3 tests/browser_check.py
```

The harness runs the actual DOM inspector against a fixture, exercises the popup with mocked Chrome APIs, and checks links, schema, regex, settings, history and downloads. It is not an installed-extension test, a Chrome Store approval, or a live external-provider certification. See `VALIDATION.md`.

## Privacy and publication

See `PRIVACY.md` for the draft privacy policy and `PERMISSIONS.md` for permission rationale. Review and host a final policy on your own website before submitting to the Chrome Web Store. Store disclosure wording must match your deployed version and backend behavior.

Developer: Shahzaib Hassan · https://shazzseo.com · info@shazzseo.com

## Version 1.1: Google results and website metrics

- Toolbar above search results and per-result metric strips on 20 Google regional domains, with and without www.
- Age, registration date, DA, PA, DR, Spam Score, backlinks, referring domains, organic traffic and monthly visits fields. Focus any result to show its data in the top toolbar.
- 10 result strips by default, optional 20; dynamic result handling, CSV export and disable control.
- Domain age uses RDAP registration events, not archive age. Regional public suffixes are parsed by the bundled tldts library.
- Configure your own Keywords Everywhere key for the link-metrics endpoint (DA/PA/Spam/link fields), and an Ahrefs key for DR, or use your licensed backend. The adapters do not bundle credentials or guarantee free/anonymous access. Traffic still requires the licensed metrics backend.
- Keys remain in trusted extension storage/background; Google content scripts receive only toolbar preferences and normalized public metrics.
- Caching: complete responses up to 24 hours; partial/unavailable responses five minutes. In-flight requests are shared; at most three domain enrichments run concurrently. Cache size is limited to 250 entries.

### Enable it

1. Reload this unpacked extension after replacing its files.
2. Open the popup, choose Integrations & privacy, and click **Enable website data access**. Chrome requests optional HTTPS access so registry redirects and configured providers can work.
3. Add your own provider keys or backend, then **Save integrations locally**.
4. Refresh your supported Google search-results tab. Use **Setup** in the toolbar to reopen settings.
5. Open any website and run Audit page to see its Website age & authority panel. With HTTPS data access already granted, this data loads automatically after the audit.

Live registry requests in the cloud environment were blocked by its egress proxy (CONNECT 403). Live provider entitlements and response compatibility are not certified; Google fixture tests use clearly labelled sample data. Full feature parity with the reference extension is still not claimed.
