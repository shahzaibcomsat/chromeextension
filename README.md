# Shahzaib SEO

Personal development copy based on the user-supplied RankSEO 5.2.38 archive. Original feature modules are retained; the extension name and internal RankSEO identifiers have been changed consistently. This is not the original Chrome Web Store listing.

## Load in Chrome

1. Open chrome://extensions and enable Developer mode.
2. Click Load unpacked and select this directory (the folder containing manifest.json).
3. Pin Shahzaib SEO, visit an ordinary HTTPS page, and open its popup.
4. Reload the extension after editing files; refresh inspected tabs after changing content scripts.

No npm installation or build is required. Chrome 116 or later is required.

## Features and services

Includes the original on-page audits, schema tools, SERP tools, rank tracking, Search Console helpers, content briefs, AI integrations and export tools. External-service features still depend on their providers, network availability, and any API keys configured in Settings. No API keys are supplied here. Broad site permissions and the debugger permission are inherited from the supplied extension.

## Provenance

The archive did not contain a source license. Original creator attributions and third-party service links remain for provenance; they do not identify Shahzaib SEO support. Obtain the necessary rights before redistributing or publishing this derivative. Existing provider endpoints have not been transferred to your ownership. The original store update URL and store verification metadata have been omitted from this development copy.

## Validation

Run `python3 tools/validate.py` to check manifest resources and JavaScript syntax (requires Node.js). Browser interaction and API-backed features require separate runtime checks.

The embedded Groq credential supplied in the original archive has been removed. Configure your own key in Settings for Groq-backed features.
