# Shahzaib SEO privacy policy draft

Developer: Shahzaib Hassan. Website: https://shazzseo.com. Contact: info@shazzseo.com.

This document describes the extension code in this release. Review it with the actual deployed backend/provider arrangements and publish an appropriate final policy before store submission.

## Local processing

When you select Audit page, the extension temporarily reads the active page's rendered document, including its URL, title, metadata, visible and some non-visible text, headings, images, links and structured data. It computes a local report. The full report stays in popup memory unless you explicitly export it or use a sharing feature. Closing the popup clears its in-memory report.

The latest 50 audit summaries are stored in Chrome local extension storage: page URL, hostname, title, audit timestamp, word count, score and number of review findings. URLs can contain sensitive query parameters; do not audit sensitive pages if you do not want those URLs in local history. Search observations similarly retain up to 50 queries, countries, target hostnames, observed ranks and timestamps.

## Optional external requests

No external requests are automatically sent when a local audit runs. The extension does not load remote fonts, analytics or advertising scripts.

When explicitly requested, technical tools contact the inspected website, Google Public DNS or the applicable supported RDAP registry. PageSpeed sends the current page URL to Google. Search sends the entered query and country to Serper. Authority metrics send the current hostname to your configured metrics backend. Keyword metrics send the query and country to your configured keyword backend. These providers/backends also receive normal network information such as your IP address.

AI generation sends your selected task, page URL, title, description, up to 30 headings and up to 1,600 characters of extracted page text to your configured AI endpoint. AI results are suggestions, not measured rankings. Do not send confidential or personal page content without appropriate authorization.

The developer does not operate a collection backend in this package. If you later configure one, update this policy to describe its operator, processing, retention and sharing. Third-party services have their own policies, account terms, usage limits and charges.

## Credentials

User-entered API keys and backend tokens are stored in Chrome local extension storage, not Chrome sync storage. The extension does not add its own encryption layer. Credentials are sent to the corresponding configured service using HTTPS. No shared provider keys are bundled.

## Controls and deletion

Integrations & privacy provides controls to delete keys/settings and revoke optional host permissions. Audit history and search research each have deletion controls for their respective stored observations. Exported files are outside the extension's control; delete them using your device's file manager. Uninstalling the extension normally removes its local extension storage; confirm browser behavior for managed devices or backups.

This release contains no analytics, advertising, sale-of-data mechanism or automatic background monitoring. Future changes to those behaviors require updated policy and store disclosures.
