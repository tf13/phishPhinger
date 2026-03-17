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
  editThreshold,
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
// getSLD
// ---------------------------------------------------------------------------

console.log('\ngetSLD');
assert('apple.com -> apple',         getSLD('apple.com'),         'apple');
assert('cdn-apple.com -> cdn-apple', getSLD('cdn-apple.com'),     'cdn-apple');
assert('google.net -> google',       getSLD('google.net'),        'google');
assert('bar.co.uk -> bar',           getSLD('bar.co.uk'),         'bar');
assert('foo.example.co.uk -> foo',   getSLD('foo.example.co.uk'), 'foo');

// ---------------------------------------------------------------------------
// editThreshold
// ---------------------------------------------------------------------------
console.log('\neditThreshold');
assert('length 1 -> 1',  editThreshold('a'),          1);
assert('length 4 -> 1',  editThreshold('bing'),        1);
assert('length 5 -> 2',  editThreshold('yahoo'),       2);
assert('length 8 -> 2',  editThreshold('linkedin'),    2);
assert('length 9 -> 3',  editThreshold('instagram'),   3);
assert('length 13 -> 3', editThreshold('stackoverflow'), 3);

// ---------------------------------------------------------------------------
// normalizeLeet (extended)
// ---------------------------------------------------------------------------
console.log('\nnormalizeLeet (extended)');
assert('3 -> e',            normalizeLeet('3mail'),      'email');
assert('4 -> a',            normalizeLeet('4mazon'),     'amazon');
assert('5 -> s',            normalizeLeet('5ecure'),     'secure');
assert('6 -> g',            normalizeLeet('6oogle'),     'google');
assert('7 -> t',            normalizeLeet('7witter'),    'twitter');
assert('8 -> b',            normalizeLeet('8ing'),       'bing');
assert('@ -> a',            normalizeLeet('@pple'),      'apple');
assert('empty string',      normalizeLeet(''),           '');
assert('no leet chars',     normalizeLeet('apple'),      'apple');
assert('2 stays as 2',      normalizeLeet('2fast'),      '2fast');
assert('all substitutions', normalizeLeet('4pp13'),      'apple');

// ---------------------------------------------------------------------------
// normalizeHomograph (extended)
// ---------------------------------------------------------------------------
console.log('\nnormalizeHomograph (extended)');
assert('Cyrillic е -> e', normalizeHomograph('\u0435'),  'e');
assert('Cyrillic о -> o', normalizeHomograph('\u043e'),  'o');
assert('Cyrillic р -> p', normalizeHomograph('\u0440'),  'p');
assert('Cyrillic с -> c', normalizeHomograph('\u0441'),  'c');
assert('Cyrillic х -> x', normalizeHomograph('\u0445'),  'x');
assert('Cyrillic і -> i', normalizeHomograph('\u0456'),  'i');
assert('Greek α -> a',    normalizeHomograph('\u03b1'),  'a');
assert('Greek ρ -> p',    normalizeHomograph('\u03c1'),  'p');
assert('Greek ν -> v',    normalizeHomograph('\u03bd'),  'v');
assert('Greek τ -> t',    normalizeHomograph('\u03c4'),  't');
assert('Greek ε -> e',    normalizeHomograph('\u03b5'),  'e');
assert('Greek κ -> k',    normalizeHomograph('\u03ba'),  'k');
assert('Greek ι -> i',    normalizeHomograph('\u03b9'),  'i');
assert('empty string',    normalizeHomograph(''),        '');
assert('plain ASCII unchanged', normalizeHomograph('google'), 'google');
// Combined Cyrillic + Greek in one string
assert('Cyrillic+Greek combo',
  normalizeHomograph('\u0430\u03bf'),  // Cyrillic а + Greek ο
  'ao');

// ---------------------------------------------------------------------------
// levenshtein (extended)
// ---------------------------------------------------------------------------
console.log('\nlevenshtein (extended)');
assert('both empty -> 0',        levenshtein('', ''),         0);
assert('symmetric a,b == b,a',   levenshtein('kitten', 'sitting') === levenshtein('sitting', 'kitten'), true);
assert('full replacement',        levenshtein('abc', 'xyz'),   3);
assert('two-char strings',        levenshtein('ab', 'ba'),     2);
assert('longer word',             levenshtein('kitten', 'sitting'), 3);

// ---------------------------------------------------------------------------
// getRegisteredDomain (extended)
// ---------------------------------------------------------------------------
console.log('\ngetRegisteredDomain (extended)');
assert('com.au two-part TLD',     getRegisteredDomain('shop.example.com.au'),  'example.com.au');
assert('com.br two-part TLD',     getRegisteredDomain('www.banco.com.br'),     'banco.com.br');
assert('com.cn two-part TLD',     getRegisteredDomain('www.foo.com.cn'),       'foo.com.cn');
assert('uppercase lowercased',    getRegisteredDomain('WWW.APPLE.COM'),        'apple.com');
assert('single-label .io TLD',    getRegisteredDomain('api.github.io'),        'github.io');

// ---------------------------------------------------------------------------
// classifyDomain (extended)
// ---------------------------------------------------------------------------
console.log('\nclassifyDomain (extended)');
assert('no dot returns null',   classifyDomain('localhost'), null);
assert('empty string -> null',  classifyDomain(''),          null);
assert('null -> null',          classifyDomain(null),        null);

// Verify exact reason values
const brandHit    = classifyDomain('audit-apple.com');
const tldHit      = classifyDomain('apple.net');
const typosquat   = classifyDomain('appple.com');
assert('brand-substring reason field',  brandHit  && brandHit.reason,   'brand-substring');
assert('tld-swap reason field',         tldHit    && tldHit.reason,     'tld-swap');
assert('typosquat reason field',        typosquat && typosquat.reason,  'typosquat');
assert('resembles is a string (brand)', brandHit  && typeof brandHit.resembles,  'string');
assert('resembles is a string (tld)',   tldHit    && typeof tldHit.resembles,    'string');

// Combined leet + homograph should still be flagged
assertHit('leet+homograph: g\u03bf\u03bfgle.com',  'g\u03bf\u03bfgle.com');
assertHit('leet+homograph: \u04304pp13.com',       '\u04304pp13.com');

// Legitimate subdomains of various brands stay safe
assertSafe('subdomain: pay.amazon.com',     'pay.amazon.com');
assertSafe('subdomain: ads.twitter.com',    'ads.twitter.com');
assertSafe('exact match: youtube.com',      'youtube.com');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
