# phishPhinger

A browser extension that watches every domain your browser contacts and warns you when one looks like it's impersonating a well-known site.

## How it works

phishPhinger compares each requested hostname against the [Cloudflare Radar top-100 domains](cloudflare-radar_top-100-domains_20260315.csv). A domain is flagged if it resembles a top-100 domain without actually being it or a subdomain of it.

| Domain | Result | Why |
|---|---|---|
| `store.apple.com` | ✅ Safe | Subdomain of `apple.com` |
| `audit-apple.com` | 🚨 Flagged | Contains brand name "apple" |
| `apple.net` | 🚨 Flagged | Same name, different TLD |
| `appple.com` | 🚨 Flagged | One-character typo |
| `app1e.com` | 🚨 Flagged | Leet-speak substitution |
| `аpple.com` *(Cyrillic а)* | 🚨 Flagged | Homograph character |

Detection is fully deterministic — no LLM, no network calls.

## Install

**Chrome / Chromium**
1. Open `chrome://extensions` and enable Developer mode
2. Click **Load unpacked** → select the `extension/` folder

**Firefox**
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** → select `extension/manifest.json`

## Usage

Once installed, phishPhinger runs silently in the background. When a suspicious domain is detected:
- The toolbar icon shows a **!** badge
- A desktop notification appears
- The popup lists recent alerts with the matched brand and detection reason

Click the toolbar icon to view the alert history or toggle **main-frame only** mode (monitors navigations only, ignores sub-resource requests).

## Updating the domain list

```bash
python scripts/generate_domains.py
```

Replace the CSV filename in the script first if using a newer Cloudflare Radar export.

## Tests

```bash
node tests/test_similarity.js
```
