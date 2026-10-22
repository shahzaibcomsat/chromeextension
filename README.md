# Shahzaib SEO — independent implementation

A new Manifest V3 extension written for Shahzaib Hassan. This release uses newly authored JavaScript, HTML, CSS, SVG artwork and PNG icons. It does not import files, libraries, icons, fingerprints, datasets or credentials from the previously supplied extension. There are no runtime third-party packages, remote fonts, analytics or build dependencies.

This is an independent implementation, not a claim of strict clean-room development: the earlier extension was inspected before this project began. Newly written code alone does not guarantee freedom from all copyright, trademark, patent, API-licensing or Chrome Web Store concerns. Review your branding, provider contracts and publication disclosures before distribution.

## Install locally

1. Download and extract this branch's ZIP.
2. Open `chrome://extensions` in Chrome 116 or later.
3. Enable Developer mode and choose **Load unpacked**.
4. Select the extracted folder containing `manifest.json`.
5. Open an ordinary HTTP/HTTPS page, open Shahzaib SEO, and click **Audit page**.

Use a different folder from the earlier renamed build. Remove that older copy if you no longer need it. This build has its own `1.0.0` version and different source structure. No server, npm installation or compilation is needed for local audits.

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
- Direct RDAP registration lookup for .com, .net, .org, .uk, .app and .dev. Supply the registered domain, not a subdomain. Other registries need an adapter.
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

This is a functional first release, not full feature parity with the reference product. It does not include built-in Moz/Ahrefs billing adapters, automated long-running rank monitoring, verified AI-search citations, full-site crawling, broken-link network checks, redirect-chain analysis, Search Console account automation, WordPress publishing, browser debugger automation, competitor datasets, historical provider databases, XLSX export or a native PDF engine. The printable report uses the browser's PDF workflow. No official rich-result validator, complete public-suffix database or exhaustive technology fingerprint collection is included.

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
