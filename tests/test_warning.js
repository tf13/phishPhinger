/**
 * tests/test_warning.js — unit tests for extension/warning.js.
 *
 * Run with Node.js:
 *   node tests/test_warning.js
 *
 * No external test framework required.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ---------------------------------------------------------------------------
// Mutable state reset between test scenarios
// ---------------------------------------------------------------------------

let _locationSearch  = '';
let locationReplaced = null;
let historyBackCalled = false;
let sentMessages     = [];
let keydownListeners = [];
let docTitle         = '';

const mockHostnameEl  = { textContent: '' };
const mockResemblesEl = { textContent: '' };
const mockReasonEl    = { textContent: '' };

const btnListeners = {};  // goBack / proceed click handlers

// ---------------------------------------------------------------------------
// Global stubs (set up before any eval)
// ---------------------------------------------------------------------------

global.browser = undefined;
global.chrome  = {
  runtime: {
    sendMessage: (msg) => sentMessages.push(msg),
  },
};

global.location = {
  get search()       { return _locationSearch; },
  replace(url)       { locationReplaced = url; },
};

global.history = {
  get length()  { return _historyLength; },
  back()        { historyBackCalled = true; },
};
let _historyLength = 2;

global.document = {
  getElementById(id) {
    if (id === 'hostnameEl')  return mockHostnameEl;
    if (id === 'resemblesEl') return mockResemblesEl;
    if (id === 'reasonEl')    return mockReasonEl;
    if (id === 'goBackBtn')   return { addEventListener(ev, fn) { btnListeners.goBack   = fn; } };
    if (id === 'proceedBtn')  return { addEventListener(ev, fn) { btnListeners.proceed  = fn; } };
    return null;
  },
  addEventListener(ev, fn) {
    if (ev === 'keydown') keydownListeners.push(fn);
  },
  get title()  { return docTitle; },
  set title(v) { docTitle = v; },
};

// ---------------------------------------------------------------------------
// Load warning.js, promoting goBack and proceed to global scope
// ---------------------------------------------------------------------------

const warningSrc = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'warning.js'),
  'utf8'
);

const promotedSrc = warningSrc +
  '\nglobal.wGoBack  = goBack;' +
  '\nglobal.wProceed = proceed;';

/** Re-eval warning.js with given query params. */
function loadWarning(params) {
  _locationSearch   = '?' + new URLSearchParams(params).toString();
  locationReplaced  = null;
  historyBackCalled = false;
  sentMessages      = [];
  keydownListeners  = [];
  docTitle          = '';
  btnListeners.goBack   = null;
  btnListeners.proceed  = null;
  eval(promotedSrc);  // eslint-disable-line no-eval
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
// Rendering
// ---------------------------------------------------------------------------
console.log('\nRendering from URL params');

loadWarning({ hostname: 'audit-apple.com', resembles: 'apple.com', reason: 'brand-substring', url: 'https://audit-apple.com/' });
assert('hostname textContent',  mockHostnameEl.textContent,  'audit-apple.com');
assert('resembles textContent', mockResemblesEl.textContent, 'apple.com');
assert('reason label mapped: brand-substring', mockReasonEl.textContent, 'brand in name');
assert('document.title contains hostname', docTitle.includes('audit-apple.com'), true);

loadWarning({ hostname: 'apple.net', resembles: 'apple.com', reason: 'tld-swap', url: 'https://apple.net/' });
assert('reason label mapped: tld-swap', mockReasonEl.textContent, 'TLD swap');

loadWarning({ hostname: 'appple.com', resembles: 'apple.com', reason: 'typosquat', url: 'https://appple.com/' });
assert('reason label mapped: typosquat', mockReasonEl.textContent, 'typosquat');

loadWarning({ hostname: 'weirdsite.com', resembles: 'google.com', reason: 'unknown-type', url: 'https://weirdsite.com/' });
assert('unknown reason passed through', mockReasonEl.textContent, 'unknown-type');

// ---------------------------------------------------------------------------
// Missing / empty params fall back to "(unknown)"
// ---------------------------------------------------------------------------
console.log('\nMissing params');

loadWarning({});
assert('missing hostname -> (unknown)',  mockHostnameEl.textContent,  '(unknown)');
assert('missing resembles -> (unknown)', mockResemblesEl.textContent, '(unknown)');
assert('missing reason -> (unknown)',    mockReasonEl.textContent,    '(unknown)');

// ---------------------------------------------------------------------------
// goBack() — history present
// ---------------------------------------------------------------------------
console.log('\ngoBack()');

loadWarning({ hostname: 'audit-apple.com', resembles: 'apple.com', reason: 'brand-substring', url: 'https://audit-apple.com/' });
_historyLength = 3;
wGoBack();
assert('history.back() called when history exists', historyBackCalled, true);
assert('location.replace NOT called when history exists', locationReplaced, null);

// ---------------------------------------------------------------------------
// goBack() — no history (e.g. link opened in new tab)
// ---------------------------------------------------------------------------
_historyLength = 1;
historyBackCalled = false;
locationReplaced  = null;
wGoBack();
assert('history.back() NOT called when no history', historyBackCalled, false);
assert('location.replace called with about:newtab', locationReplaced, 'about:newtab');

// ---------------------------------------------------------------------------
// proceed()
// ---------------------------------------------------------------------------
console.log('\nproceed()');

loadWarning({ hostname: 'audit-apple.com', resembles: 'apple.com', reason: 'brand-substring', url: 'https://audit-apple.com/path?q=1' });
wProceed();
assert('bypass message sent',       sentMessages.length, 1);
assert('bypass message type',       sentMessages[0].type, 'bypass');
assert('bypass message hostname',   sentMessages[0].hostname, 'audit-apple.com');
assert('location.replace to origUrl', locationReplaced, 'https://audit-apple.com/path?q=1');

// proceed() when no URL param — should not navigate
loadWarning({ hostname: 'audit-apple.com', resembles: 'apple.com', reason: 'brand-substring' });
wProceed();
assert('no navigation when url param absent', locationReplaced, null);

// ---------------------------------------------------------------------------
// Keyboard: Escape → goBack
// ---------------------------------------------------------------------------
console.log('\nKeyboard shortcuts');

_historyLength = 3;
loadWarning({ hostname: 'audit-apple.com', resembles: 'apple.com', reason: 'brand-substring', url: 'https://audit-apple.com/' });

let prevented = false;
keydownListeners[0]({ key: 'Escape', preventDefault() { prevented = true; } });
assert('Escape calls history.back()',    historyBackCalled, true);
assert('Escape calls preventDefault()', prevented, true);

// Other keys do not trigger goBack
historyBackCalled = false;
keydownListeners[0]({ key: 'Enter', preventDefault() {} });
assert('Enter does not call goBack', historyBackCalled, false);

keydownListeners[0]({ key: 'ArrowLeft', preventDefault() {} });
assert('ArrowLeft does not call goBack', historyBackCalled, false);

// ---------------------------------------------------------------------------
// Button click listeners registered
// ---------------------------------------------------------------------------
console.log('\nButton wiring');

loadWarning({ hostname: 'audit-apple.com', resembles: 'apple.com', reason: 'brand-substring', url: 'https://audit-apple.com/' });
assert('goBackBtn click listener registered',  typeof btnListeners.goBack,  'function');
assert('proceedBtn click listener registered', typeof btnListeners.proceed, 'function');

_historyLength = 2;
historyBackCalled = false;
btnListeners.goBack();
assert('goBackBtn click calls goBack', historyBackCalled, true);

locationReplaced = null;
btnListeners.proceed();
assert('proceedBtn click calls proceed', locationReplaced, 'https://audit-apple.com/');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
