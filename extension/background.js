/**
 * background.js — phishPhinger service worker.
 *
 * Monitors browser web requests and alerts the user when a hostname
 * resembles a Cloudflare Radar top-100 domain (possible phishing).
 *
 * Compatible with Chrome (MV3) and Firefox (WebExtensions MV3, FF 109+).
 */

importScripts('top-domains.js', 'similarity.js');

// Chrome / Firefox API compatibility shim
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

const ALERT_KEY  = 'phishAlerts';
const CONFIG_KEY = 'phishConfig';
const MAX_ALERTS = 200;

/** Default configuration. */
const DEFAULT_CONFIG = { mainFrameOnly: false, showWarning: false };

/** In-memory config cache — updated whenever storage changes. */
let config = { ...DEFAULT_CONFIG };

/** Per-session hostname deduplication set — avoids repeated badge/notification
 *  for the same host within a browsing session. */
const seen = new Set();

/** Hostnames the user has chosen to proceed past the warning this session. */
const bypassed = new Set();

// ---------------------------------------------------------------------------
// Initialise config from storage
// ---------------------------------------------------------------------------
browserAPI.storage.sync.get({ [CONFIG_KEY]: DEFAULT_CONFIG }, result => {
  config = { ...DEFAULT_CONFIG, ...result[CONFIG_KEY] };
});

browserAPI.storage.sync.onChanged.addListener(changes => {
  if (changes[CONFIG_KEY]) {
    config = { ...DEFAULT_CONFIG, ...changes[CONFIG_KEY].newValue };
  }
});

// ---------------------------------------------------------------------------
// Message listener — warning page sends { type: 'bypass', hostname }
// ---------------------------------------------------------------------------
browserAPI.runtime.onMessage.addListener(({ type, hostname }) => {
  if (type === 'bypass' && hostname) bypassed.add(hostname);
});

// ---------------------------------------------------------------------------
// Web request listener
// ---------------------------------------------------------------------------
browserAPI.webRequest.onBeforeRequest.addListener(
  ({ url, type, tabId }) => {
    try {
      // Honour "main-frame only" setting
      if (config.mainFrameOnly && type !== 'main_frame') return;

      const hostname = new URL(url).hostname;
      if (!hostname) return;

      // Already processed this session — skip silently
      if (seen.has(hostname)) return;

      const hit = classifyDomain(hostname);
      if (!hit) return;

      // -----------------------------------------------------------------------
      // Blocking warning popup (main-frame navigations only, not already bypassed)
      // -----------------------------------------------------------------------
      if (config.showWarning && type === 'main_frame' && tabId > 0 && !bypassed.has(hostname)) {
        const warningUrl = browserAPI.runtime.getURL(
          `warning.html?hostname=${encodeURIComponent(hostname)}` +
          `&resembles=${encodeURIComponent(hit.resembles)}` +
          `&reason=${encodeURIComponent(hit.reason)}` +
          `&url=${encodeURIComponent(url)}`
        );
        browserAPI.tabs.update(tabId, { url: warningUrl });
        // Don't add to `seen` here — if the user goes back and retries,
        // they should see the warning again.
        return;
      }

      // Mark seen before async work so duplicate events don't race
      seen.add(hostname);

      // -----------------------------------------------------------------------
      // Persist alert to local storage
      // -----------------------------------------------------------------------
      browserAPI.storage.local.get({ [ALERT_KEY]: [] }, result => {
        const alerts = result[ALERT_KEY];
        alerts.unshift({
          hostname,
          resembles: hit.resembles,
          reason: hit.reason,
          ts: Date.now(),
        });
        if (alerts.length > MAX_ALERTS) alerts.length = MAX_ALERTS;
        browserAPI.storage.local.set({ [ALERT_KEY]: alerts });
      });

      // -----------------------------------------------------------------------
      // Update toolbar badge
      // -----------------------------------------------------------------------
      browserAPI.action.setBadgeText({ text: '!' });
      browserAPI.action.setBadgeBackgroundColor({ color: '#e53e3e' });

      // -----------------------------------------------------------------------
      // Desktop notification
      // -----------------------------------------------------------------------
      browserAPI.notifications.create(`pf-${Date.now()}`, {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: 'Suspicious domain — possible phishing',
        message: `${hostname}  resembles  ${hit.resembles}  (${hit.reason})`,
      });
    } catch (_) {
      // Silently ignore malformed URLs or extension API errors
    }
  },
  { urls: ['<all_urls>'] }
);
