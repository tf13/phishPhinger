# phishPhinger — Project Plan

## What it does

phishPhinger is a **browser extension** that passively monitors every domain
your browser contacts and alerts you when a domain looks like it could be
impersonating a well-known site (a likely phishing indicator).

Detection is **entirely deterministic** — no LLM, no cloud calls, no external
APIs at runtime.

---

## What counts as suspicious?

A domain is suspicious when it *resembles* one of the
[Cloudflare Radar top-100 domains](cloudflare-radar_top-100-domains_20260315.csv)
but is **not** that domain or a legitimate subdomain of it.

| Domain | Verdict | Reason |
|---|---|---|
| `store.apple.com` | ✅ Safe | Subdomain of `apple.com` |
| `apple.com` | ✅ Safe | Exact match |
| `audit-apple.com` | 🚨 Suspicious | Contains brand "apple" |
| `apple-store.com` | 🚨 Suspicious | Contains brand "apple" |
| `apple.net` | 🚨 Suspicious | Same name, different TLD |
| `appple.com` | 🚨 Suspicious | Typosquat (edit distance 1) |
| `app1e.com` | 🚨 Suspicious | Leet-speak (`1` → `l`) |
| `аpple.com` (Cyrillic а) | 🚨 Suspicious | Homograph attack |

---

## Architecture

A **Manifest V3 browser extension**, compatible with Chrome/Chromium and
Firefox (v109+).

```
phishPhinger/
├── scripts/
│   └── generate_domains.py       # CSV → extension/top-domains.js (run once)
├── extension/
│   ├── manifest.json             # MV3 manifest (Chrome + Firefox)
│   ├── background.js             # Service worker: monitors requests, fires alerts
│   ├── similarity.js             # Deterministic domain analysis engine
│   ├── top-domains.js            # Generated from CSV; bundled with extension
│   ├── popup.html                # Toolbar popup: alert history + config toggle
│   ├── popup.js                  # Popup controller
│   └── icons/icon-128.png        # Extension icon
└── tests/
    └── test_similarity.js        # Node.js unit tests (no framework needed)
```

---

## Detection algorithm (`extension/similarity.js`)

For each browser request, the hostname is classified in two passes:

### Pass 1 — Safe pre-check (against all 100 entries)
If the hostname's registered domain **exactly matches** any top-100 domain, or
if it is a **subdomain** of one, it is immediately marked safe and no further
checks are done.

### Pass 2 — Suspicious checks (against all 100 brand tokens)
The second-level domain (SLD) of the query is extracted and tested in four
normalised forms:

| Variant | Example transformation |
|---|---|
| Raw | `app1e-store` |
| Leet-normalised | `apple-store` (`1`→`l`) |
| Homograph-normalised | `аpple` → `apple` (Cyrillic/Greek confusables) |
| Both | leet + homograph combined |

Each variant is checked against the brand token of every top-100 entry:

1. **Brand-substring**: variant *contains* the brand token → suspicious
   (`apple-store` contains `apple`)
2. **TLD-swap**: variant *equals* the brand token but the TLD differs → suspicious
   (`apple.net` → SLD `apple` == brand `apple`)
3. **Typosquat**: Levenshtein edit distance ≤ threshold → suspicious
   (`appple` vs `apple`: distance 1; threshold for 5-char brand = 1)

---

## Browser integration (`extension/background.js`)

- Uses `chrome.webRequest.onBeforeRequest` with `<all_urls>` to observe every
  request (Chrome + Firefox).
- Suspicious hostnames are deduplicated within a session to suppress repeated
  alerts for the same host.
- Alerts are stored in `chrome.storage.local` (up to 200 entries).
- A toolbar badge (`!`) and a desktop notification are shown for each new hit.
- A **"main-frame only"** toggle (persisted in `chrome.storage.sync`) lets the
  user limit monitoring to navigated-to pages and suppress sub-resource noise.

---

## Popup UI (`extension/popup.html`)

- **Config toggle**: "Monitor all requests" vs "Main-frame only"
- **Alert table**: last 20 suspicious domains with the top-100 domain they
  resemble, the detection reason, and the time
- **Clear button**: resets the alert log and badge

---

## Setup

### Install the extension

**Chrome / Chromium:**
1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `extension/` folder

**Firefox:**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `extension/manifest.json`

### Regenerate the domain list

If you want to update to a newer Cloudflare Radar CSV:

```bash
# Replace the CSV filename in scripts/generate_domains.py, then:
python scripts/generate_domains.py
```

Commit the updated `extension/top-domains.js`.

---

## Tests

```bash
node tests/test_similarity.js
```

No external dependencies required.

---

## Future extensions (not in scope yet)

- Configurable domain list (load additional CSVs or user-defined brands)
- Per-domain allow-listing ("I know this site is safe")
- Detection reason explanations shown inline on the page
- Support for the full [Public Suffix List](https://publicsuffix.org/) for
  more accurate eTLD+1 extraction
