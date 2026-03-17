/**
 * tests/test_background.js — unit tests for extension/background.js.
 *
 * Focuses on the showWarning / bypass / config-merge behaviour added in
 * the warning-interstitial feature.  The badge / notification / storage
 * paths are also exercised as regression coverage.
 *
 * Run with Node.js:
 *   node tests/test_background.js
 *
 * No external test framework required.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ---------------------------------------------------------------------------
// 1. Pre-load similarity engine into global scope.
//    background.js calls importScripts('top-domains.js','similarity.js');
//    we mock importScripts as a no-op and supply the functions ourselves.
// ---------------------------------------------------------------------------

const topDomainsCode = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'top-domains.js'), 'utf8'
);
eval(topDomainsCode.replace('const TOP_DOMAINS =', 'global.TOP_DOMAINS ='));

const sim = require('../extension/similarity.js');
Object.assign(global, sim);          // classifyDomain et al. now on global

global.importScripts = () => {};     // no-op — deps already loaded above

// ---------------------------------------------------------------------------
// 2. Captured listener references (populated when background.js is eval'd)
// ---------------------------------------------------------------------------

let requestListener   = null;   // webRequest.onBeforeRequest handler
let messageListener   = null;   // runtime.onMessage handler
let configChangeListener = null; // storage.sync.onChanged handler

// ---------------------------------------------------------------------------
// 3. Observable side-effects reset between tests
// ---------------------------------------------------------------------------

const tabsUpdates   = [];
const notifications = [];
let   storedAlerts  = [];
let   badgeText     = '';

// ---------------------------------------------------------------------------
// 4. Chrome API stub
// ---------------------------------------------------------------------------

global.browser = undefined;
global.chrome  = {
  runtime: {
    getURL:    (p)       => `chrome-extension://test-id/${p}`,
    onMessage: { addListener: (fn) => { messageListener = fn; } },
  },
  storage: {
    sync: {
      get: (defaults, cb) => cb({ ...defaults }),   // returns defaults (showWarning: false initially)
      set: () => {},
      onChanged: { addListener: (fn) => { configChangeListener = fn; } },
    },
    local: {
      get: (defaults, cb) => cb({ phishAlerts: storedAlerts }),
      set: (obj)          => { if (obj.phishAlerts) storedAlerts = [...obj.phishAlerts]; },
    },
  },
  action: {
    setBadgeText:            (o) => { badgeText = o.text; },
    setBadgeBackgroundColor: () => {},
  },
  notifications: {
    create: (_id, opts) => notifications.push(opts),
  },
  tabs: {
    update: (tabId, opts) => tabsUpdates.push({ tabId, ...opts }),
  },
  webRequest: {
    onBeforeRequest: {
      addListener: (fn) => { requestListener = fn; },
    },
  },
};

// ---------------------------------------------------------------------------
// 5. Load background.js, promoting `seen` and `bypassed` to global so tests
//    can clear them between scenarios without re-eval'ing the whole file.
// ---------------------------------------------------------------------------

const bgSrc = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'background.js'), 'utf8'
)
  .replace(
    'const seen = new Set();',
    'global.bgSeen = new Set(); const seen = global.bgSeen;'
  )
  .replace(
    'const bypassed = new Set();',
    'global.bgBypassed = new Set(); const bypassed = global.bgBypassed;'
  );

eval(bgSrc);

// Helper: enable showWarning via the config-change listener
function setConfig(cfg) {
  configChangeListener({ phishConfig: { newValue: cfg } });
}

// Helper: reset per-test mutable state
function reset() {
  global.bgSeen.clear();
  global.bgBypassed.clear();
  tabsUpdates.length   = 0;
  notifications.length = 0;
  storedAlerts         = [];
  badgeText            = '';
}

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓  ${description}`);
    passed++;
  } else {
    console.error(`  ✗  ${description}`);
    console.error(`       expected: ${JSON.stringify(expected)}`);
    console.error(`       actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Listener registration
// ---------------------------------------------------------------------------
console.log('\nListener registration');
assert('requestListener registered',      typeof requestListener,      'function');
assert('messageListener registered',      typeof messageListener,      'function');
assert('configChangeListener registered', typeof configChangeListener, 'function');

// ---------------------------------------------------------------------------
// DEFAULT_CONFIG — showWarning defaults to false (no redirect on first load)
// ---------------------------------------------------------------------------
console.log('\nDefault config — showWarning: false');

reset();
// The initial storage.sync.get returns DEFAULT_CONFIG (showWarning: false).
// A suspicious main-frame request should NOT redirect.
requestListener({ url: 'https://fakeapple.com/', type: 'main_frame', tabId: 1 });
assert('no redirect by default',             tabsUpdates.length,  0);
assert('badge set without redirect',         badgeText,           '!');
assert('notification sent without redirect', notifications.length, 1);
assert('alert stored',                       storedAlerts.length,  1);

// ---------------------------------------------------------------------------
// showWarning: true — redirect main-frame hits to warning page
// ---------------------------------------------------------------------------
console.log('\nshowWarning: true — redirect');

reset();
setConfig({ mainFrameOnly: false, showWarning: true });
requestListener({ url: 'https://fakeapple.com/', type: 'main_frame', tabId: 1 });
assert('tabs.update called',           tabsUpdates.length,  1);
assert('correct tab targeted',         tabsUpdates[0].tabId, 1);

const redirectUrl = tabsUpdates[0].url;
assert('redirects to extension page',  redirectUrl.startsWith('chrome-extension://'), true);
assert('warning.html in redirect URL', redirectUrl.includes('warning.html'),          true);
assert('hostname in redirect URL',     redirectUrl.includes('hostname=fakeapple.com'), true);
assert('resembles in redirect URL',    redirectUrl.includes('resembles='),             true);
assert('reason in redirect URL',       redirectUrl.includes('reason='),                true);
assert('original url in redirect URL', redirectUrl.includes('url='),                   true);
assert('badge NOT set on redirect',    badgeText,                                      '');
assert('no notification on redirect',  notifications.length,                           0);
assert('no alert stored on redirect',  storedAlerts.length,                            0);

// hostname NOT added to seen — next visit should still show the warning
assert('hostname not in seen after redirect', global.bgSeen.has('fakeapple.com'), false);

// ---------------------------------------------------------------------------
// showWarning: true — sub-frame requests are NOT redirected
// ---------------------------------------------------------------------------
console.log('\nshowWarning: true — sub-frame skipped');

reset();
setConfig({ mainFrameOnly: false, showWarning: true });
requestListener({ url: 'https://fakeapple.com/', type: 'sub_frame', tabId: 1 });
assert('sub-frame not redirected', tabsUpdates.length, 0);
assert('sub-frame gets badge',     badgeText,          '!');

// ---------------------------------------------------------------------------
// showWarning: true — tabId <= 0 (no visible tab, e.g. background fetch) not redirected
// ---------------------------------------------------------------------------
console.log('\nshowWarning: true — no valid tab');

reset();
setConfig({ mainFrameOnly: false, showWarning: true });
requestListener({ url: 'https://fakeapple.com/', type: 'main_frame', tabId: 0 });
assert('tabId 0 not redirected', tabsUpdates.length, 0);

reset();
requestListener({ url: 'https://fakeapple.com/', type: 'main_frame', tabId: -1 });
assert('tabId -1 not redirected', tabsUpdates.length, 0);

// ---------------------------------------------------------------------------
// Bypass — proceed-anyway message clears the redirect block
// ---------------------------------------------------------------------------
console.log('\nBypass after proceed-anyway');

reset();
setConfig({ mainFrameOnly: false, showWarning: true });

// User proceeds past the warning → background receives bypass message
messageListener({ type: 'bypass', hostname: 'fakeapple.com' });
assert('hostname added to bypassed set', global.bgBypassed.has('fakeapple.com'), true);

// Next navigation to the same host should NOT redirect, but SHOULD alert
global.bgSeen.clear();  // clear seen so the host is processed again
requestListener({ url: 'https://fakeapple.com/', type: 'main_frame', tabId: 1 });
assert('bypassed host not redirected', tabsUpdates.length,   0);
assert('bypassed host gets badge',     badgeText,            '!');
assert('bypassed host gets alert',     storedAlerts.length,  1);
assert('hostname added to seen after bypass', global.bgSeen.has('fakeapple.com'), true);

// ---------------------------------------------------------------------------
// Bypass message with wrong type is ignored
// ---------------------------------------------------------------------------
console.log('\nBypass message validation');

reset();
messageListener({ type: 'other', hostname: 'fakeapple.com' });
assert('wrong message type not added to bypassed', global.bgBypassed.has('fakeapple.com'), false);

messageListener({ type: 'bypass', hostname: '' });
assert('empty hostname not added to bypassed', global.bgBypassed.has(''), false);

// ---------------------------------------------------------------------------
// Safe domain — never redirected or alerted
// ---------------------------------------------------------------------------
console.log('\nSafe domain');

reset();
setConfig({ mainFrameOnly: false, showWarning: true });
requestListener({ url: 'https://apple.com/', type: 'main_frame', tabId: 1 });
assert('safe domain not redirected',    tabsUpdates.length,   0);
assert('safe domain no notification',   notifications.length, 0);
assert('safe domain no alert',          storedAlerts.length,  0);

// ---------------------------------------------------------------------------
// mainFrameOnly: true — sub-resources entirely ignored
// ---------------------------------------------------------------------------
console.log('\nmainFrameOnly: true');

reset();
setConfig({ mainFrameOnly: true, showWarning: false });
requestListener({ url: 'https://fakeapple.com/', type: 'sub_frame', tabId: 1 });
assert('sub-frame ignored with mainFrameOnly', badgeText, '');

reset();
requestListener({ url: 'https://fakeapple.com/', type: 'main_frame', tabId: 1 });
assert('main-frame still processed with mainFrameOnly', badgeText, '!');

// ---------------------------------------------------------------------------
// Deduplication — seen set prevents repeated alerts for same hostname
// ---------------------------------------------------------------------------
console.log('\nDeduplication (seen set)');

reset();
setConfig({ mainFrameOnly: false, showWarning: false });
requestListener({ url: 'https://fakeapple.com/', type: 'main_frame', tabId: 1 });
assert('first request → 1 notification',  notifications.length, 1);
requestListener({ url: 'https://fakeapple.com/', type: 'main_frame', tabId: 1 });
assert('duplicate request → still 1 notification', notifications.length, 1);

// ---------------------------------------------------------------------------
// Alert storage — capped at MAX_ALERTS (200)
// ---------------------------------------------------------------------------
console.log('\nAlert storage');

reset();
setConfig({ mainFrameOnly: false, showWarning: false });
// Seed 200 existing alerts
storedAlerts = Array.from({ length: 200 }, (_, i) => ({ hostname: `old${i}.com`, ts: 0 }));
requestListener({ url: 'https://fakeapple.com/', type: 'main_frame', tabId: 1 });
assert('alerts capped at 200', storedAlerts.length, 200);
assert('newest alert at index 0', storedAlerts[0].hostname, 'fakeapple.com');

// ---------------------------------------------------------------------------
// Config merge — DEFAULT_CONFIG fills missing keys
// ---------------------------------------------------------------------------
console.log('\nConfig merge');

reset();
// Simulate a partial config change (only mainFrameOnly provided, no showWarning)
configChangeListener({ phishConfig: { newValue: { mainFrameOnly: true } } });
// showWarning should default to false (DEFAULT_CONFIG merge)
requestListener({ url: 'https://fakeapple.com/', type: 'main_frame', tabId: 1 });
assert('missing showWarning key defaults to false (no redirect)', tabsUpdates.length, 0);

// ---------------------------------------------------------------------------
// Malformed URL — silently ignored
// ---------------------------------------------------------------------------
console.log('\nMalformed URL');

reset();
setConfig({ mainFrameOnly: false, showWarning: false });
requestListener({ url: 'not-a-url', type: 'main_frame', tabId: 1 });
assert('malformed URL does not throw', true, true);
assert('malformed URL produces no alert', storedAlerts.length, 0);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
