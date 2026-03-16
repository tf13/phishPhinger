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
const DEFAULT_CONFIG = { mainFrameOnly: false };

/** In-memory config cache — updated whenever storage changes. */
let config = { ...DEFAULT_CONFIG };

/** Per-session hostname deduplication set — avoids repeated alerts for the
 *  same host within a browsing session. */
const seen = new Set();

// ---------------------------------------------------------------------------
// Initialise config from storage
// ---------------------------------------------------------------------------
browserAPI.storage.sync.get({ [CONFIG_KEY]: DEFAULT_CONFIG }, result => {
  config = result[CONFIG_KEY];
});

browserAPI.storage.sync.onChanged.addListener(changes => {
  if (changes[CONFIG_KEY]) {
    config = changes[CONFIG_KEY].newValue;
  }
});

// ---------------------------------------------------------------------------
// Web request listener
// ---------------------------------------------------------------------------
browserAPI.webRequest.onBeforeRequest.addListener(
  ({ url, type }) => {
    try {
      // Honour "main-frame only" setting
      if (config.mainFrameOnly && type !== 'main_frame') return;

      const hostname = new URL(url).hostname;
      if (!hostname) return;

      // Deduplicate within this session
      if (seen.has(hostname)) return;
      seen.add(hostname);

      const hit = classifyDomain(hostname);
      if (!hit) return;

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
