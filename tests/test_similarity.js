/**
 * tests/test_similarity.js — unit tests for the similarity engine.
 *
 * Run with Node.js:
 *   node tests/test_similarity.js
 *
 * No external test framework required.
 */

'use strict';

// ---------------------------------------------------------------------------
// Load the similarity module (Node.js CommonJS)
// ---------------------------------------------------------------------------

// Provide a minimal TOP_DOMAINS stub before requiring similarity.js,
// then replace it with the real generated list.
const path = require('path');
const fs   = require('fs');

// Load top-domains.js and inject TOP_DOMAINS into the global scope so that
// similarity.js can access it when require()'d (mirrors importScripts order
// in the extension's service worker).
const topDomainsCode = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'top-domains.js'), 'utf8'
);
// Replace `const` with `global.` assignment so the variable leaks out of eval
eval(topDomainsCode.replace('const TOP_DOMAINS =', 'global.TOP_DOMAINS ='));

const {
  getRegisteredDomain,
  getSLD,
  normalizeLeet,
  normalizeHomograph,
  levenshtein,
  classifyDomain,
} = require('../extension/similarity.js');

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

function assertHit(description, hostname) {
  const result = classifyDomain(hostname);
  const ok = result !== null && typeof result.resembles === 'string';
  if (ok) {
    console.log(`  ✓  ${description}  →  resembles ${result.resembles} (${result.reason})`);
    passed++;
  } else {
    console.error(`  ✗  ${description}: expected a hit but got ${JSON.stringify(result)}`);
    failed++;
  }
}

function assertSafe(description, hostname) {
  const result = classifyDomain(hostname);
  const ok = result === null;
  if (ok) {
    console.log(`  ✓  ${description}  →  safe`);
    passed++;
  } else {
    console.error(`  ✗  ${description}: expected safe but got ${JSON.stringify(result)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// getRegisteredDomain
// ---------------------------------------------------------------------------
console.log('\ngetRegisteredDomain');
assert('strips www',               getRegisteredDomain('www.apple.com'),     'apple.com');
assert('plain domain',             getRegisteredDomain('apple.com'),         'apple.com');
assert('subdomain',                getRegisteredDomain('store.apple.com'),   'apple.com');
assert('deep subdomain',           getRegisteredDomain('a.b.google.com'),    'google.com');
assert('two-part TLD',             getRegisteredDomain('foo.example.co.uk'), 'example.co.uk');

// ---------------------------------------------------------------------------
// normalizeLeet
// ---------------------------------------------------------------------------
console.log('\nnormalizeLeet');
assert('leet digits',   normalizeLeet('app1e'),   'apple');
assert('g00gle',        normalizeLeet('g00gle'),  'google');
assert('rn -> m',       normalizeLeet('arnazon'), 'amazon');
assert('vv -> w',       normalizeLeet('tvvitter'), 'twitter');

// ---------------------------------------------------------------------------
// normalizeHomograph
// ---------------------------------------------------------------------------
console.log('\nnormalizeHomograph');
// Cyrillic а (\u0430) looks identical to Latin a
assert('Cyrillic а in apple', normalizeHomograph('\u0430pple'), 'apple');
// Greek ο (\u03bf) looks like Latin o
assert('Greek ο in google',   normalizeHomograph('g\u03bfgle'), 'gogle');  // still needs edit-dist

// ---------------------------------------------------------------------------
// levenshtein
// ---------------------------------------------------------------------------
console.log('\nlevenshtein');
assert('identical strings',  levenshtein('apple', 'apple'),   0);
assert('single insertion',   levenshtein('appple', 'apple'),  1);
assert('single deletion',    levenshtein('aple', 'apple'),    1);
assert('single substitution',levenshtein('epple', 'apple'),   1);
assert('one edit (deletion)', levenshtein('gogle', 'google'),  1);
assert('empty vs string',    levenshtein('', 'abc'),          3);

// ---------------------------------------------------------------------------
// classifyDomain — SAFE cases
// ---------------------------------------------------------------------------
console.log('\nclassifyDomain — safe');
assertSafe('exact match: apple.com',         'apple.com');
assertSafe('exact match: google.com',        'google.com');
assertSafe('subdomain: store.apple.com',     'store.apple.com');
assertSafe('subdomain: mail.google.com',     'mail.google.com');
assertSafe('deep subdomain: a.b.amazon.com', 'a.b.amazon.com');
assertSafe('exact match: netflix.com',       'netflix.com');
assertSafe('exact match: cdn-apple.com',     'cdn-apple.com');   // in top-100 list

// ---------------------------------------------------------------------------
// classifyDomain — SUSPICIOUS cases
// ---------------------------------------------------------------------------
console.log('\nclassifyDomain — suspicious');
assertHit('brand-substring: audit-apple.com',      'audit-apple.com');
assertHit('brand-substring: apple-store.com',      'apple-store.com');
assertHit('brand-substring: secure-google.com',    'secure-google.com');
assertHit('TLD swap: apple.net',                   'apple.net');
assertHit('TLD swap: google.net',                  'google.net');
assertHit('typosquat: appple.com (extra p)',        'appple.com');
assertHit('typosquat: amazom.com (n->m)',           'amazom.com');
assertHit('leet: app1e.com',                       'app1e.com');
assertHit('leet: g00gle.com',                      'g00gle.com');
assertHit('homograph: Cyrillic а in apple',        '\u0430pple.com');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
