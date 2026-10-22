# Shahzaib SEO privacy policy draft

Developer: Shahzaib Hassan. Website: https://shazzseo.com. Contact: info@shazzseo.com.

This document describes the extension code in this release. Review it with the actual deployed backend/provider arrangements and publish an appropriate final policy before store submission.

## Local processing

When you select Audit page, the extension temporarily reads the active page's rendered document, including its URL, title, metadata, visible and some non-visible text, headings, images, links and structured data. It computes a local report. The full report stays in popup memory unless you explicitly export it or use a sharing feature. Closing the popup clears its in-memory report.

The latest 50 audit summaries are stored in Chrome local extension storage: page URL, hostname, title, audit timestamp, word count, score and number of review findings. URLs can contain sensitive query parameters; do not audit sensitive pages if you do not want those URLs in local history. Search observations similarly retain up to 50 queries, countries, target hostnames, observed ranks and timestamps.

## Optional external requests

After optional website-data access is granted, domain age and configured provider metrics may be fetched following an audit. The Google results toolbar is enabled by default on supported Google search pages; you can disable it in Integrations or with its Hide button. It scans up to 10 (optionally 20) result links and, once network access is granted, shares their registered domains with RDAP registries and configured metric providers. The toolbar itself does not send the search query to those providers. The extension does not load remote fonts, analytics or advertising scripts.

When requested by a tool or enabled results enrichment, technical tools contact the inspected website, Google Public DNS or the applicable supported RDAP registry. PageSpeed sends the current page URL to Google. Search sends the entered query and country to Serper. Authority metrics send the current hostname to your configured metrics backend. Keyword metrics send the query and country to your configured keyword backend. These providers/backends also receive normal network information such as your IP address.

AI generation sends your selected task, page URL, title, description, up to 30 headings and up to 1,600 characters of extracted page text to your configured AI endpoint. AI results are suggestions, not measured rankings. Do not send confidential or personal page content without appropriate authorization.

The developer does not operate a collection backend in this package. If you later configure one, update this policy to describe its operator, processing, retention and sharing. Third-party services have their own policies, account terms, usage limits and charges.

## Credentials

User-entered API keys and backend tokens are stored in Chrome local extension storage, not Chrome sync storage. The extension does not add its own encryption layer. Credentials are sent to the corresponding configured service using HTTPS. No shared provider keys are bundled.

## Controls and deletion

Integrations & privacy provides controls to delete keys/settings and revoke optional host permissions. Audit history and search research each have deletion controls for their respective stored observations. Exported files are outside the extension's control; delete them using your device's file manager. Uninstalling the extension normally removes its local extension storage; confirm browser behavior for managed devices or backups.

This release contains no analytics, advertising, sale-of-data mechanism or automatic background monitoring. Future changes to those behaviors require updated policy and store disclosures.

## Website metric caching and content scripts

The background stores up to 250 domain-metric cache entries with source labels and fetch times. Complete entries expire after 24 hours; partial results after five minutes. Cached results can include provider-authority scores, link/traffic counts and registration dates. These are domain-level data, separate from audit and search histories. Removing the extension clears its storage; the Clear website cache control also removes these entries. Provider keys are restricted to trusted extension contexts; the Google content script receives normalized results and toolbar preferences, not key values.

The packaged tldts parser is MIT licensed and runs locally. It does not send hostnames to its publisher. Google pages can change structure and break result detection; this is not an official Google product.

## Version 1.2 public-service requests

With website-data access granted and public lookups enabled, result domains may also be sent to Keywords Everywhere's keyless link-metrics endpoint, SimilarWeb and SEMrush public endpoints. These requests omit user keys unless the user explicitly enables their saved Keywords Everywhere key. Public traffic estimates are enabled by default but can be disabled in Integrations; keyless KE requests can also be disabled. Saving a key alone does not enable its use. Third-party request logs, rate limits and terms still apply.

On explicit clicks, Wayback receives the target registered domain, Google Suggest receives the entered query and country, and the DNS tool requests additional CNAME/SOA/CAA records. Registration results can include registrar, expiry and nameservers. Manual provider-checker and ICANN links open those third-party sites in the normal browser.
