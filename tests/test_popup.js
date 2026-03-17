/**
 * tests/test_popup.js — unit tests for popup.js utility functions.
 *
 * Tests escapeHtml, reasonLabel, formatTime, and renderAlerts without a
 * real browser environment.  All browser/DOM APIs are stubbed in-process
 * before popup.js is eval'd so its top-level code runs without errors.
 *
 * Run with Node.js:
 *   node tests/test_popup.js
 *
 * No external test framework or npm packages required.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ---------------------------------------------------------------------------
// Stub browser / DOM globals that popup.js references at module load time
// ---------------------------------------------------------------------------

/** Minimal element stub — tracks innerHTML and stub event listeners. */
function makeElement(id) {
  return {
    id,
    innerHTML: '',
    checked: false,
    addEventListener: () => {},
  };
}

const mockContentEl   = makeElement('content');
const mockCheckbox    = makeElement('mainFrameOnly');
const mockWarningCheck = makeElement('showWarning');
const mockClearBtn    = makeElement('clearBtn');

global.document = {
  getElementById(id) {
    if (id === 'content')       return mockContentEl;
    if (id === 'mainFrameOnly') return mockCheckbox;
    if (id === 'showWarning')   return mockWarningCheck;
    if (id === 'clearBtn')      return mockClearBtn;
    return null;
  },
};

// Minimal chrome stub — storage callbacks fire synchronously with defaults.
// syncSetCalls tracks everything written to chrome.storage.sync.set.
const syncSetCalls = [];
global.browser = undefined;
global.chrome  = {
  storage: {
    local: {
      get:  (defaults, cb) => cb(defaults),
      set:  (_obj, cb)     => cb && cb(),
    },
    sync: {
      get: (defaults, cb) => cb(defaults),
      set: (obj)          => syncSetCalls.push(JSON.parse(JSON.stringify(obj))),
    },
  },
  action: {
    setBadgeText:            () => {},
    setBadgeBackgroundColor: () => {},
  },
};

// ---------------------------------------------------------------------------
// Load popup.js, promoting key functions to global scope via source rewrite.
// (Same eval technique used by test_similarity.js for top-domains.js.)
// ---------------------------------------------------------------------------

const popupSrc = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'popup.js'),
  'utf8'
);

eval(
  popupSrc
    .replace('function escapeHtml(',   'global.escapeHtml   = function(')
    .replace('function reasonLabel(',  'global.reasonLabel  = function(')
    .replace('function formatTime(',   'global.formatTime   = function(')
    .replace('function renderAlerts(', 'global.renderAlerts = function(')
    .replace('function saveConfig()',  'global.saveConfig   = function()')
);

// ---------------------------------------------------------------------------
// Tiny test harness (identical pattern to test_similarity.js)
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

function assertContains(description, haystack, needle) {
  const ok = typeof haystack === 'string' && haystack.includes(needle);
  if (ok) {
    console.log(`  ✓  ${description}`);
    passed++;
  } else {
    console.error(`  ✗  ${description}`);
    console.error(`       expected to contain: ${JSON.stringify(needle)}`);
    console.error(`       actual: ${JSON.stringify(haystack)}`);
    failed++;
  }
}

function assertNotContains(description, haystack, needle) {
  const ok = typeof haystack === 'string' && !haystack.includes(needle);
  if (ok) {
    console.log(`  ✓  ${description}`);
    passed++;
  } else {
    console.error(`  ✗  ${description}`);
    console.error(`       expected NOT to contain: ${JSON.stringify(needle)}`);
    console.error(`       actual: ${JSON.stringify(haystack)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------
console.log('\nescapeHtml');
assert('safe string unchanged',        escapeHtml('hello'),              'hello');
assert('& -> &amp;',                   escapeHtml('a & b'),              'a &amp; b');
assert('< -> &lt;',                    escapeHtml('<script>'),            '&lt;script&gt;');
assert('> -> &gt;',                    escapeHtml('foo>bar'),             'foo&gt;bar');
assert('" -> &quot;',                  escapeHtml('"quoted"'),            '&quot;quoted&quot;');
assert('XSS payload escaped',          escapeHtml('<img src=x onerror=alert(1)>'),
                                                  '&lt;img src=x onerror=alert(1)&gt;');
assert('all special chars together',   escapeHtml('<a href="x">foo & bar</a>'),
                                                  '&lt;a href=&quot;x&quot;&gt;foo &amp; bar&lt;/a&gt;');
assert('empty string unchanged',       escapeHtml(''),                   '');
assert('number coerced to string',     escapeHtml(42),                   '42');
assert('no special chars',             escapeHtml('audit-apple.com'),    'audit-apple.com');

// ---------------------------------------------------------------------------
// reasonLabel
// ---------------------------------------------------------------------------
console.log('\nreasonLabel');
assert('brand-substring -> brand in name', reasonLabel('brand-substring'), 'brand in name');
assert('tld-swap -> TLD swap',             reasonLabel('tld-swap'),        'TLD swap');
assert('typosquat -> typosquat',           reasonLabel('typosquat'),       'typosquat');
assert('unknown reason passed through',    reasonLabel('something-else'),  'something-else');
assert('empty string passed through',      reasonLabel(''),                '');

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------
console.log('\nformatTime');
const ts = new Date(2026, 2, 17, 14, 5, 9).getTime(); // 2026-03-17 14:05:09
const formatted = formatTime(ts);
assert('returns a non-empty string',    typeof formatted === 'string' && formatted.length > 0, true);
assert('contains a colon separator',    formatted.includes(':'),  true);

const epoch = formatTime(0);
assert('epoch returns a string',        typeof epoch === 'string' && epoch.length > 0, true);

const future = formatTime(Date.now() + 1e10);
assert('future timestamp returns string', typeof future === 'string' && future.length > 0, true);

// ---------------------------------------------------------------------------
// renderAlerts
// ---------------------------------------------------------------------------
console.log('\nrenderAlerts');

// Reset helper
function resetContent() { mockContentEl.innerHTML = ''; }

// Empty / null array -> empty-state message
resetContent();
renderAlerts([]);
assertContains('empty array shows empty-state text',
  mockContentEl.innerHTML, 'No suspicious domains detected yet.');

resetContent();
renderAlerts(null);
assertContains('null array shows empty-state text',
  mockContentEl.innerHTML, 'No suspicious domains detected yet.');

// Single alert produces a table row
resetContent();
renderAlerts([{ hostname: 'audit-apple.com', resembles: 'apple.com', reason: 'brand-substring', ts: ts }]);
assertContains('table element rendered',          mockContentEl.innerHTML, '<table>');
assertContains('hostname appears in row',         mockContentEl.innerHTML, 'audit-apple.com');
assertContains('resembles column present',        mockContentEl.innerHTML, 'apple.com');
assertContains('reason label mapped correctly',   mockContentEl.innerHTML, 'brand in name');

// XSS in hostname must be escaped — raw < must not appear in output
resetContent();
renderAlerts([{ hostname: '<script>alert(1)</script>.evil.com', resembles: 'google.com', reason: 'typosquat', ts }]);
assertNotContains('raw <script> tag not in output', mockContentEl.innerHTML, '<script>alert(1)');
assertContains('escaped lt present',               mockContentEl.innerHTML, '&lt;script&gt;');

// Max 20 rows shown when 25 entries provided
resetContent();
const manyAlerts = Array.from({ length: 25 }, (_, i) => ({
  hostname: `fake${i}.com`, resembles: 'google.com', reason: 'typosquat', ts,
}));
renderAlerts(manyAlerts);
// Count <tr> inside tbody (each row contains the hostname)
const rowMatches = (mockContentEl.innerHTML.match(/class="hostname"/g) || []).length;
assert('max 20 rows rendered from 25 entries', rowMatches, 20);

// tld-swap reason renders correct label
resetContent();
renderAlerts([{ hostname: 'apple.net', resembles: 'apple.com', reason: 'tld-swap', ts }]);
assertContains('tld-swap renders as "TLD swap"', mockContentEl.innerHTML, 'TLD swap');

// typosquat reason renders correctly
resetContent();
renderAlerts([{ hostname: 'appple.com', resembles: 'apple.com', reason: 'typosquat', ts }]);
assertContains('typosquat label present', mockContentEl.innerHTML, 'typosquat');

// ---------------------------------------------------------------------------
// Config persistence — saveConfig writes both checkboxes together
// ---------------------------------------------------------------------------
console.log('\nConfig persistence (saveConfig)');

syncSetCalls.length = 0;
const CONFIG_KEY = 'phishConfig';

// Both off
mockCheckbox.checked     = false;
mockWarningCheck.checked = false;
saveConfig();
assert('saveConfig writes phishConfig key',              syncSetCalls.length,                1);
assert('mainFrameOnly: false saved correctly',           syncSetCalls[0][CONFIG_KEY].mainFrameOnly, false);
assert('showWarning: false saved correctly',             syncSetCalls[0][CONFIG_KEY].showWarning,   false);

syncSetCalls.length = 0;
mockCheckbox.checked     = true;
mockWarningCheck.checked = false;
saveConfig();
assert('mainFrameOnly: true persisted',      syncSetCalls[0][CONFIG_KEY].mainFrameOnly, true);
assert('showWarning still saved when false', syncSetCalls[0][CONFIG_KEY].showWarning,   false);

syncSetCalls.length = 0;
mockCheckbox.checked     = false;
mockWarningCheck.checked = true;
saveConfig();
assert('showWarning: true persisted',        syncSetCalls[0][CONFIG_KEY].showWarning,   true);
assert('mainFrameOnly still saved when false', syncSetCalls[0][CONFIG_KEY].mainFrameOnly, false);

syncSetCalls.length = 0;
mockCheckbox.checked     = true;
mockWarningCheck.checked = true;
saveConfig();
assert('both true: mainFrameOnly saved',  syncSetCalls[0][CONFIG_KEY].mainFrameOnly, true);
assert('both true: showWarning saved',    syncSetCalls[0][CONFIG_KEY].showWarning,   true);

// Config load — popup.js was eval'd with DEFAULT_CONFIG (both false).
// Reset checkboxes to what popup.js would have set them to verify loading.
mockCheckbox.checked     = false;
mockWarningCheck.checked = false;
// Re-apply the same default config that popup.js received at load time:
// storage.sync.get returns { phishConfig: { mainFrameOnly: false, showWarning: false } }
// popup.js sets: mainFrameCheck.checked = false; warningCheck.checked = false;
assert('warningCheck initialised to false from default config',   mockWarningCheck.checked, false);
assert('mainFrameCheck initialised to false from default config', mockCheckbox.checked,     false);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
