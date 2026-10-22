# Validation evidence

Verified in this cloud workspace:

- Node syntax checks for the extension modules.
- Node tests for scoring, missing evidence, CSV formula escaping, backend configuration errors, null versus zero metrics, domain mismatch rejection, invalid score rejection, bodyless HEAD responses, privileged sender restrictions, keyword null handling, Serper response handling and RDAP provider selection.
- Chromium browser harness: actual DOM extraction from a test fixture; invalid JSON-LD and heading-skip detection; missing versus decorative image alt; UI navigation and fixed-width layout; link filters; schema generation; required configuration errors; regex worker; HTTPS-only settings validation; local history deletion; CSV download. No uncaught page errors.

The browser harness substitutes Chrome APIs with test doubles. It does not prove installed extension loading in a user's Chrome profile. Google/Moz/Ahrefs/Serper/backend/AI provider access, billing, accuracy, privacy terms and Chrome Web Store acceptance are unverified. No real user credentials were requested or exercised. Full feature parity is not claimed; see README for exclusions.

Version 1.1 adds domain parsing/registration-date/KE-field tests and a Google SERP fixture harness covering the top toolbar, per-result strips, null values, selecting a result, CSV export, settings opening, dynamic results and disabling. `python3 tests/serp_check.py` uses sample provider data, not live results. Public registry requests from this cloud runner failed at the network proxy with CONNECT 403. These failures do not establish that the registries are unavailable to a user's installed Chrome.

Version 1.2 tests public-response parsing, absent versus zero fields, domain mismatches, keyless KE mode (saved key is not transmitted), Google Suggest without a paid search provider, archive dates/URLs and explicit blocked-request handling. Browser fixture checks exercise the Suggest and Wayback controls and verify saved-key use stays off by default. These remain mocked-provider tests.
