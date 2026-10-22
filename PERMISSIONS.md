# Permission rationale

- `activeTab`: temporary access to the page selected by the user after interacting with the extension. Temporary access powers the page audit. A separate Google-only content script handles the enabled SERP toolbar.
- `scripting`: inject the local DOM inspector into the selected tab on Audit page.
- `storage`: store local settings, user keys and bounded audit/search summary histories.
- Optional `http://*/*` and `https://*/*`: make explicit user-requested website and integration calls. The manifest declares selectable origins; it does not grant access to every site on install. Each network action requests its needed origin through Chrome, and all optional host grants can be revoked in Integrations.

No debugger, tabs, clipboard, notifications, background web-request interception or downloads permission is requested. Basic downloads use Blob URLs and the browser's normal download mechanism. The popup reads the active tab through temporary activeTab access.

Content Security Policy permits only packaged scripts and disallows objects/base URLs. Page content and provider responses are escaped before insertion; no external script or model output is evaluated. Regex expressions run in a dedicated worker with a one-second lifetime limit.

Google search content-script matches permit the toolbar on the supported regional Google search pages. The script extracts result destinations and displays extension-generated metric strips. It does not read provider keys. Enabling website-data access requests optional HTTPS origin access, needed for public RDAP registry redirects and configured API hosts; local audits themselves do not require this broad optional grant. Revoke it in Integrations to stop those outbound requests.
